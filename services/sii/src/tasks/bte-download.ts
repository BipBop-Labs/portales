import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PortalError, invalidInput } from '../../../../packages/runtime/src/errors.js';
import { validateDownloadedFile } from '../../../../packages/runtime/src/downloads.js';
import { resolveDestination, publishArtifactFile } from '../../../../packages/runtime/src/destinations.js';
import { withSession } from '../auth/index.js';
import { assertOperatingSelf } from '../auth/session.js';
import { Rut } from '../rut/index.js';
import { Periodo } from '../periodo/index.js';
import { fetchBteMensual, fetchBtePdf, printBteCancellationReport } from '../portal/bte.js';
import type { Runtime } from '../seams/index.js';

/** Fetch only a document discovered in the selected principal's monthly issued listing.
 * Validate both parties and folio in the PDF before publishing it outside the checkout. */
export async function bteDownload(runtime: Runtime, args: { profile: string; periodo: string; folio: number; cancellationReport?: boolean; output?: string; destination?: string }) {
  const periodo = Periodo.parse(args.periodo);
  const documentType = args.cancellationReport ? 'bhe-cancellation-report-pdf' : 'bhe-issued-pdf';
  if (!Number.isSafeInteger(args.folio) || args.folio <= 0) throw invalidInput('A positive folio is required.', [{ field: '--folio', expected: 'folio from bte list' }]);
  if (!runtime.files) throw new PortalError('LOCAL_DEPENDENCY_MISSING', 'The document file sink is unavailable.');
  await assertOperatingSelf(runtime, () => invalidInput('Boletas must use the authenticated principal.', [{ field: 'scope', expected: 'principal' }]));
  // Fail locally when identity verification cannot run; never publish an unverified PDF.
  try { await promisify(execFile)('pdftotext', ['-v']); } catch { throw new PortalError('LOCAL_DEPENDENCY_MISSING', 'Install pdftotext to verify the boleta PDF.'); }
  const document = await withSession(runtime, async (session, ctx) => {
    const rut = Rut.parse(ctx.sessionRut);
    const identifiers = { principal: rut.canonical, periodo: periodo.formatted, folio: String(args.folio) };
    const target = await resolveDestination({ service: 'sii', profile: args.profile, documentType, identifiers, ...(args.output === undefined ? {} : { output: args.output }), ...(args.destination === undefined ? {} : { destination: args.destination }) });
    const monthly = await fetchBteMensual(session, { rut, periodo, side: 'EMITIDAS' }, () => runtime.clock.sleep(1000));
    const found = monthly.boletas.filter(b => b.folio === args.folio);
    if (found.length !== 1 || found[0] === undefined) throw invalidInput('The folio must identify exactly one issued boleta in this period.', [{ field: '--folio', expected: 'one folio returned by bte list for the selected period' }]);
    const boleta = found[0];
    if (!boleta.codigo || !/^[A-Za-z0-9]+$/.test(boleta.codigo) || !boleta.contraparteRut) throw new PortalError('CONTRACT_MISMATCH', 'Expected a document barcode and recipient in the issued row.');
    if (args.cancellationReport && (boleta.estado !== 'ANUL' || !boleta.fechaAnulacion)) throw invalidInput('The folio must be annulled to print cancellation evidence.', [{ field: '--folio', expected: 'annulled folio', discoverWith: 'portales sii bte cancel-list <periodo> --profile <profile>' }]);
    await runtime.clock.sleep(1000);
    const bytes = args.cancellationReport
      ? await printBteCancellationReport(session, { rut, periodo, boleta }, () => runtime.clock.sleep(1000))
      : await fetchBtePdf(session, boleta.codigo);
    return { boleta, receptor: boleta.contraparteRut, principal: rut.canonical, bytes, identifiers, target };
  });
  const { identifiers, target } = document;
  const temp = await mkdtemp(join(tmpdir(), 'portales-bhe-'));
  try {
    const name = `bhe-${args.cancellationReport ? 'anulacion-' : ''}${args.folio}-${randomUUID()}.pdf`;
    const path = await runtime.files.write(temp, name, document.bytes);
    const validated = await validateDownloadedFile(path, 'application/pdf');
    const { stdout } = await promisify(execFile)('pdftotext', ['-layout', path, '-'], { maxBuffer: 2 * 1024 * 1024 });
    const normalized = stdout.replace(/[−–—]/gu, '-').replace(/[.\s]/gu, '').toUpperCase();
    const checks = ['private-permissions', 'signature', 'issuer-in-text', 'recipient-in-text'];
    if (![document.principal, document.receptor].every(rut => normalized.includes(rut))) throw new PortalError('DOWNLOAD_INVALID', 'The PDF does not identify the selected issuer and recipient.');
    if (args.cancellationReport) {
      const date = document.boleta.fechaAnulacion;
      if (!date || !/^\d{2}\/\d{2}\/\d{4}$/u.test(date)) throw new PortalError('CONTRACT_MISMATCH', 'Expected an annulment date in DD/MM/YYYY format.');
      const rowPattern = new RegExp(`(?:^|[ \t])${args.folio}[ \t]+ANUL[ \t]+${date}(?=[ \t\r\n]|$)`, 'mu');
      if (!normalized.includes('INFORMEMENSUALDEBOLETASEMITIDAS') || !rowPattern.test(stdout)) throw new PortalError('DOWNLOAD_INVALID', 'The official report PDF does not tie the selected folio to ANUL and its annulment date.');
      checks.push('official-monthly-report', 'folio-annulled-date-in-same-row');
    } else {
      if (!new RegExp(`N[°º]${args.folio}(?![0-9])`, 'u').test(normalized)) throw new PortalError('DOWNLOAD_INVALID', 'The PDF does not identify the selected folio.');
      checks.push('content-type', 'folio-in-text');
    }
    const finalPath = await publishArtifactFile(path, target.directory, name);
    return { ...validated, path: finalPath, identifiers, documentType, coveredPeriod: null, validationChecks: checks, boleta: document.boleta, destination: target.source };
  } finally { await rm(temp, { recursive: true, force: true }); }
}
