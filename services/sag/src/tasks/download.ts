import { execFile } from 'node:child_process';
import { access, link, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { validateDownloadedFile } from '../../../../packages/runtime/src/downloads.js';
import { PortalError } from '../../../bci-pyme/src/errors.js';
import { readSagReceipt } from '../portal/receipt.js';

export const downloadMetadata = {
  service: 'sag', operation: 'declaracion-jurada.download', effect: 'read', auth: 'public',
} as const;

const receiptSchema = z.object({
  folio: z.string().regex(/^[1-9]\d*$/u),
  declarationId: z.string().regex(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}-\d{13}$/u),
  fullName: z.string().trim().min(3), documentNumber: z.string().trim().min(3),
  arrivalDate: z.iso.date(), borderControlLabel: z.string().trim().min(3),
  sagProducts: z.enum(['0', '1']), minorsLuggage: z.enum(['0', '1']),
}).strict();

/** Downloads an existing English-language receipt once, verifying its labeled fields before publishing the file. */
export async function downloadSagDeclaration(input: unknown, output: string) {
  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success) throw new PortalError('INVALID_INPUT', 'Provide final folio, declarationId, and expected receipt fields from the completed declaration in a private JSON file.');
  const expected = parsed.data;
  const target = resolve(output);
  let parent: string;
  try {
    parent = await realpath(dirname(target));
    if (((await stat(parent)).mode & 0o077) !== 0) throw new Error('not private');
    // Never put traveler documents inside a checkout, including symlinked paths.
    for (let directory = parent; ; directory = dirname(directory)) {
      const inRepository = await access(join(directory, '.git')).then(() => true, () => false);
      if (inRepository) throw new Error('repository output');
      if (dirname(directory) === directory) break;
    }
    const exists = await access(join(parent, basename(target))).then(() => true, () => false);
    if (exists) throw new Error('existing output');
  } catch {
    throw new PortalError('INVALID_INPUT', 'Output must be a new file in an existing private directory outside any repository.');
  }
  const execute = promisify(execFile);
  try {
    await execute('pdftotext', ['-v'], { timeout: 5_000 });
  } catch {
    throw new PortalError('INVALID_INPUT', 'Install pdftotext before retrieving a SAG receipt; it is required for content verification.');
  }
  const temporary = await mkdtemp(join(parent, '.sag-receipt-'));
  const path = join(temporary, 'receipt.pdf');
  try {
    await writeFile(path, await readSagReceipt(expected.folio, expected.declarationId), { mode: 0o600, flag: 'wx' });
    const descriptor = await validateDownloadedFile(path, 'application/pdf');
    const { stdout } = await execute('pdftotext', ['-layout', path, '-'], { timeout: 10_000, maxBuffer: 1_000_000 });
    const arrivalDate = expected.arrivalDate.split('-').reverse().join('-');
    const wanted = {
      'Folio Number': expected.folio,
      Identification: expected.fullName,
      'Document Number': expected.documentNumber,
      'SAG Sworn Statement': expected.sagProducts === '0' ? 'No' : 'Yes',
      'Declare luggage for minors': expected.minorsLuggage === '0' ? 'No' : 'Yes',
      'Arrival date to Chile': arrivalDate,
      'Entry Point to Chile': expected.borderControlLabel,
    };
    const lines = stdout.split(/\r?\n/u).map(line => line.trim().replace(/\s+/gu, ' '));
    if (!lines.includes('Affidavit for Entry into Chile')
      || Object.entries(wanted).some(([label, value]) => lines.filter(line => line === `${label}: ${value}`).length !== 1)) {
      throw new PortalError('PORTAL_CHANGED', 'The PDF does not match the expected labeled receipt fields or language. Reconcile the completed declaration; do not submit again.');
    }
    const finalPath = join(parent, basename(target));
    // Atomic no-overwrite publication after all checks, on the same filesystem.
    await link(path, finalPath);
    return { ...descriptor, path: finalPath, folio: expected.folio, verified: true };
  } catch (error: unknown) {
    if (error instanceof PortalError) throw error;
    throw new PortalError('PORTAL_CHANGED', 'The SAG receipt could not be verified or saved. Inspect local output and dependencies; do not submit again.');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
