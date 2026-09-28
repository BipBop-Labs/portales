import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PortalError, invalidInput } from '../../../../packages/runtime/src/errors.js';
import { recordAudit } from '../audit/index.js';
import { withSession } from '../auth/index.js';
import { assertOperatingSelf } from '../auth/session.js';
import { Rut } from '../rut/index.js';
import { Periodo } from '../periodo/index.js';
import type { Runtime } from '../seams/index.js';
import { fetchBteMensual } from '../portal/bte.js';
import { loadBtePrevious, previewBtePrevious, issueBtePrevious, BTE_PREVIOUS_CONTRACT, btePreviousIntentSchema, type BtePreviousOverrides } from '../portal/bte-previous.js';

const overridesSchema = z.object({
  fecha: z.iso.date().optional(),
  lineas: z.array(z.object({ glosa: z.string().trim().min(1).max(100), monto: z.number().int().positive().max(99_999_999) }).strict()).min(1).max(4).optional(),
}).strict();
const sourceSchema = z.number().int().positive().max(999_999_999);
const TTL_MS = 15 * 60 * 1000;
type Prepared = Awaited<ReturnType<typeof previewBtePrevious>>;
const snapshotSchema = z.object({
  id: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/u), expiresAt: z.iso.datetime(), status: z.enum(['prepared', 'consumed']),
  intent: btePreviousIntentSchema,
  preview: z.object({ totalHonorarios: z.number().int().positive(), retencion: z.number().int().nonnegative(), liquido: z.number().int().nonnegative(), porcentajeRetencion: z.string(), retiene: z.enum(['RECEPTOR', 'EMISOR']) }),
});
type Snapshot = z.infer<typeof snapshotSchema>;
const fingerprint = (prepared: Prepared): string => createHash('sha256').update(JSON.stringify({ intent: prepared.intent, preview: prepared.preview })).digest('hex');

async function requireSelf(runtime: Runtime): Promise<void> {
  await assertOperatingSelf(runtime, () => invalidInput('Boletas must use the authenticated principal.', [{ field: 'scope', expected: 'principal' }]));
}
function validateOverrides(value: BtePreviousOverrides): BtePreviousOverrides {
  const parsed = overridesSchema.safeParse(value);
  if (!parsed.success) throw invalidInput('Invalid boleta overrides.', parsed.error.issues.map(i => ({ field: i.path.join('.'), expected: i.message })));
  return { ...(parsed.data.fecha === undefined ? {} : { fecha: parsed.data.fecha }), ...(parsed.data.lineas === undefined ? {} : { lineas: parsed.data.lineas }) };
}
function validateSource(folio: number): void {
  if (!sourceSchema.safeParse(folio).success) throw invalidInput('A positive source folio is required.', [{ field: '--from-folio', expected: 'an issued folio', discoverWith: 'portales sii bte list <periodo> --profile <profile>' }]);
}

/** Prepare a new boleta from an issued folio; persist only intent and preview, never portal hidden fields. */
export async function btePreparePrevious(runtime: Runtime, args: { folio: number } & BtePreviousOverrides) {
  validateSource(args.folio);
  const overrides = validateOverrides({ ...(args.fecha === undefined ? {} : { fecha: args.fecha }), ...(args.lineas === undefined ? {} : { lineas: args.lineas }) });
  await requireSelf(runtime);
  const prepared = await withSession(runtime, async (session, ctx) => {
    const original = await loadBtePrevious(session, Rut.parse(ctx.sessionRut), args.folio);
    return previewBtePrevious(session, original, overrides);
  });
  const id = randomUUID();
  const snapshot = { ...prepared, id, fingerprint: fingerprint(prepared), expiresAt: new Date(runtime.clock.now().getTime() + TTL_MS).toISOString(), status: 'prepared' as const };
  await runtime.store.write(`bte-prepare-${id}`, snapshot);
  recordAudit(runtime, { action: 'bte_prepare', result: 'ok' });
  return { emitida: false, snapshot: id, fingerprint: snapshot.fingerprint, expiresAt: snapshot.expiresAt, ...prepared, supportedScopes: ['principal'] };
}

/** Confirm exactly one prepared intent. A consumed or uncertain snapshot can never be resubmitted. */
export async function bteEmitPrevious(runtime: Runtime, args: { snapshot: string; confirm?: string }) {
  if (!z.uuid().safeParse(args.snapshot).success) throw invalidInput('Invalid snapshot identifier.', [{ field: '--snapshot', expected: 'identifier returned by bte prepare' }]);
  const key = `bte-prepare-${args.snapshot}`;
  const parsed = snapshotSchema.safeParse(await runtime.store.read<unknown>(key));
  if (!parsed.success || parsed.data.id !== args.snapshot || Date.parse(parsed.data.expiresAt) <= runtime.clock.now().getTime()) {
    throw new PortalError('SNAPSHOT_EXPIRED', 'Prepare the boleta again before issuing.');
  }
  const snapshot: Snapshot = parsed.data;
  if (snapshot.status !== 'prepared') throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'This snapshot was already consumed. Reconcile the issued listing; never resubmit it.');
  if (args.confirm !== snapshot.fingerprint || fingerprint(snapshot) !== snapshot.fingerprint) throw new PortalError('CONFIRMATION_REQUIRED', 'Confirm the exact fingerprint returned by bte prepare.');
  const source = Number(snapshot.intent.source);
  validateSource(source);
  const overrides = validateOverrides({ fecha: snapshot.intent.fecha, lineas: snapshot.intent.lineas });
  await requireSelf(runtime);
  return withSession(runtime, async (session, ctx) => {
    if (snapshot.intent.principal !== Rut.parse(ctx.sessionRut).canonical) throw new PortalError('AUTHORIZATION_DENIED', 'The prepared boleta belongs to another principal.');
    const original = await loadBtePrevious(session, Rut.parse(ctx.sessionRut), source);
    const current = await previewBtePrevious(session, original, overrides);
    if (fingerprint(current) !== snapshot.fingerprint) throw new PortalError('SNAPSHOT_STALE', 'The source, account, recipient, domicile, or server-computed preview changed. Prepare and review again.');
    if (Date.parse(snapshot.expiresAt) <= runtime.clock.now().getTime()) throw new PortalError('SNAPSHOT_EXPIRED', 'The preparation expired before final submission.');
    await runtime.store.write(key, { ...snapshot, status: 'consumed' });
    recordAudit(runtime, { action: 'bte_emit_previous', result: 'attempt' });
    try {
      const codigo = await issueBtePrevious(session);
      await runtime.clock.sleep(1000);
      const month = await fetchBteMensual(session, { rut: Rut.parse(ctx.sessionRut), periodo: Periodo.parse(current.intent.fecha.slice(0, 7)), side: 'EMITIDAS' }, () => runtime.clock.sleep(1000));
      const matching = month.boletas.filter(b => b.codigo === codigo);
      const row = matching[0];
      if (matching.length !== 1 || !row || row.estado !== 'VIG' || row.contraparteRut !== Rut.parse(current.intent.receptor).canonical || row.totalHonorarios !== current.preview.totalHonorarios || row.honorariosLiquidos !== current.preview.liquido || row.retencionReceptor !== (current.preview.retiene === 'RECEPTOR' ? current.preview.retencion : 0) || row.retencionEmisor !== (current.preview.retiene === 'EMISOR' ? current.preview.retencion : 0) || row.fecha !== current.intent.fecha.split('-').reverse().join('/')) {
        throw new Error('Post-write verification did not match the prepared intent.');
      }
      await runtime.store.write(key, { ...snapshot, status: 'consumed', verified: true });
      recordAudit(runtime, { action: 'bte_emit_previous', result: 'verified' });
      return { emitida: true, verified: true, boleta: row, preview: current.preview, supportedScopes: ['principal'] };
    } catch (error: unknown) {
      recordAudit(runtime, { action: 'bte_emit_previous', result: 'ambiguous' });
      throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'The issue attempt may have reached SII. The snapshot is consumed; reconcile the monthly issued listing without repeating it.', { cause: error, recovery: { remoteMutationPossible: true, safeToRetry: false, contractRef: BTE_PREVIOUS_CONTRACT, nextAction: 'Read the monthly issued listing for the prepared date before any further emission.' } });
    }
  });
}
