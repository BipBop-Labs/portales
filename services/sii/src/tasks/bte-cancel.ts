import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PortalError, invalidInput } from '../../../../packages/runtime/src/errors.js';
import { recordAudit } from '../audit/index.js';
import { withSession, assertOperatingSelf } from '../auth/session.js';
import { Periodo } from '../periodo/index.js';
import { Rut } from '../rut/index.js';
import type { PortalSession, Runtime } from '../seams/index.js';
import { fetchBteMensual, type BteBoleta } from '../portal/bte.js';
import { BTE_CANCEL_CONTRACT, cancellationPreviewSchema, openBteCancellation, previewBteCancellation, submitBteCancellation, type CancellationPreview } from '../portal/bte-cancel.js';

const snapshotSchema = z.object({
  id: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/u), expiresAt: z.iso.datetime(), status: z.enum(['prepared', 'consumed']),
  periodo: z.string().regex(/^\d{4}-\d{2}$/u), preview: cancellationPreviewSchema,
});
const fingerprint = (periodo: string, preview: CancellationPreview) => createHash('sha256').update(JSON.stringify({ operation: 'bte.cancel', periodo, preview })).digest('hex');
const requireSelf = (runtime: Runtime) => assertOperatingSelf(runtime, () => new PortalError('AUTHORIZATION_DENIED', 'Cancellation requires the authenticated principal.'));

export async function bteCancellationOptions(runtime: Runtime) {
  await requireSelf(runtime);
  return withSession(runtime, async (session, ctx) => ({ field: 'causa', options: await openBteCancellation(session, Rut.parse(ctx.sessionRut)) }));
}

function matches(row: BteBoleta, preview: CancellationPreview): boolean {
  return row.folio === preview.folio && row.codigo === preview.codigo && row.fecha === preview.fecha.split('-').reverse().join('/') && row.contraparteRut === preview.receptor
    && row.totalHonorarios === preview.totalHonorarios && row.honorariosLiquidos === preview.liquido
    && row.retencionEmisor !== null && row.retencionReceptor !== null && row.retencionEmisor + row.retencionReceptor === preview.retencion;
}
async function currentPreview(runtime: Runtime, session: PortalSession, principal: Rut, periodo: string, folio: number, causa: string) {
  const month = await fetchBteMensual(session, { rut: principal, periodo: Periodo.parse(periodo), side: 'EMITIDAS' }, () => runtime.clock.sleep(1000));
  const rows = month.boletas.filter(row => row.folio === folio);
  if (rows.length !== 1 || rows[0]?.estado !== 'VIG') throw invalidInput('Expected one active issued boleta in the selected month.', [{ field: '--folio', expected: 'active issued folio', discoverWith: 'portales sii bte list <periodo> --profile <profile>' }]);
  const preview = await previewBteCancellation(session, principal, folio, causa);
  if (!matches(rows[0], preview)) throw new PortalError('CONTRACT_MISMATCH', 'The cancellation preview differs from the selected monthly document.', { recovery: { contractRef: BTE_CANCEL_CONTRACT } });
  return preview;
}

/** Preview a principal-owned, active boleta and bind its reason, identity and notification warning for 15 minutes. */
export async function btePrepareCancellation(runtime: Runtime, args: { periodo: string; folio: number; causa: string }) {
  Periodo.parse(args.periodo);
  if (!z.number().int().positive().max(999_999_999).safeParse(args.folio).success || !z.string().regex(/^[1-3]$/u).safeParse(args.causa).success) {
    throw invalidInput('A positive folio and a discovered cancellation cause are required.', [{ field: '--causa', expected: 'live cause ID', discoverWith: 'portales sii bte cancel-options --profile <profile>' }]);
  }
  await requireSelf(runtime);
  const preview = await withSession(runtime, (session, ctx) => currentPreview(runtime, session, Rut.parse(ctx.sessionRut), args.periodo, args.folio, args.causa));
  const snapshot = { id: randomUUID(), periodo: args.periodo, preview, fingerprint: fingerprint(args.periodo, preview), expiresAt: new Date(runtime.clock.now().getTime() + 15 * 60_000).toISOString(), status: 'prepared' as const };
  await runtime.store.write(`bte-cancel-${snapshot.id}`, snapshot);
  recordAudit(runtime, { action: 'bte_cancel_prepare', result: 'ok' });
  return { anulada: false, snapshot: snapshot.id, fingerprint: snapshot.fingerprint, expiresAt: snapshot.expiresAt, preview, supportedScopes: ['principal'] };
}

/** Consume a confirmed preparation before one mutation. Any uncertain result requires a read, never another submission. */
export async function bteCancel(runtime: Runtime, args: { snapshot: string; confirm?: string }) {
  if (!z.uuid().safeParse(args.snapshot).success) throw invalidInput('Invalid cancellation snapshot.', [{ field: '--snapshot', expected: 'identifier from bte cancel-prepare' }]);
  const key = `bte-cancel-${args.snapshot}`;
  const parsed = snapshotSchema.safeParse(await runtime.store.read<unknown>(key));
  if (!parsed.success || parsed.data.id !== args.snapshot || Date.parse(parsed.data.expiresAt) <= runtime.clock.now().getTime()) throw new PortalError('SNAPSHOT_EXPIRED', 'Prepare the cancellation again before confirming.');
  const snapshot = parsed.data;
  if (snapshot.status !== 'prepared') throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'This cancellation was already attempted. Reconcile the monthly listing; never resubmit.');
  if (args.confirm !== snapshot.fingerprint || fingerprint(snapshot.periodo, snapshot.preview) !== snapshot.fingerprint) throw new PortalError('CONFIRMATION_REQUIRED', 'Confirm the exact cancellation fingerprint.');
  await requireSelf(runtime);
  return withSession(runtime, async (session, ctx) => {
    const principal = Rut.parse(ctx.sessionRut);
    if (!principal.equals(Rut.parse(snapshot.preview.principal))) throw new PortalError('AUTHORIZATION_DENIED', 'The cancellation belongs to another principal.');
    const current = await currentPreview(runtime, session, principal, snapshot.periodo, snapshot.preview.folio, snapshot.preview.causa);
    if (fingerprint(snapshot.periodo, current) !== snapshot.fingerprint) throw new PortalError('SNAPSHOT_STALE', 'The boleta or cancellation warning changed. Prepare and review again.');
    if (Date.parse(snapshot.expiresAt) <= runtime.clock.now().getTime()) throw new PortalError('SNAPSHOT_EXPIRED', 'The cancellation expired before submission.');
    await runtime.store.write(key, { ...snapshot, status: 'consumed' });
    recordAudit(runtime, { action: 'bte_cancel', result: 'attempt' });
    try {
      await submitBteCancellation(session, current);
      const month = await fetchBteMensual(session, { rut: principal, periodo: Periodo.parse(snapshot.periodo), side: 'EMITIDAS' }, () => runtime.clock.sleep(1000));
      const rows = month.boletas.filter(row => matches(row, current));
      if (rows.length !== 1 || rows[0]?.estado !== 'ANUL' || !rows[0].fechaAnulacion) throw new Error('Cancellation was not verified in the issued listing.');
      recordAudit(runtime, { action: 'bte_cancel', result: 'verified' });
      return { anulada: true, verified: true, boleta: rows[0], causa: current.causa, notificaReceptor: current.notificaReceptor, supportedScopes: ['principal'] };
    } catch (error: unknown) {
      recordAudit(runtime, { action: 'bte_cancel', result: 'ambiguous' });
      throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'The cancellation may have reached SII. Reconcile the monthly listing without repeating the mutation.', { cause: error, recovery: { contractRef: BTE_CANCEL_CONTRACT, remoteMutationPossible: true, safeToRetry: false, nextAction: 'Read the issued monthly listing. If still pending, inspect the SII cancellation status before any further action.' } });
    }
  });
}

/** List only annulled principal-issued documents, without mixing in the report's active-only totals. */
export async function bteCancellationList(runtime: Runtime, args: { periodo: string }) {
  const periodo = Periodo.parse(args.periodo);
  await requireSelf(runtime);
  return withSession(runtime, async (session, ctx) => {
    const month = await fetchBteMensual(session, { rut: Rut.parse(ctx.sessionRut), periodo, side: 'EMITIDAS' }, () => runtime.clock.sleep(1000));
    const boletas = month.boletas.filter(row => row.estado === 'ANUL');
    return { principal: month.rut, periodo: month.periodo, totalBoletas: boletas.length, boletas, supportedScopes: ['principal'] };
  });
}
