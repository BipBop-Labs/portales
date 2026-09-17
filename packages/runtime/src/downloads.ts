import { createHash } from 'node:crypto';
import { chmod, readFile, stat } from 'node:fs/promises';
import JSZip from 'jszip';
import { PortalError } from './errors.js';

export type SupportedDownloadMediaType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface FileDescriptor {
  path: string;
  mediaType: SupportedDownloadMediaType;
  byteCount: number;
  sha256: string;
}


class DownloadValidationError extends PortalError {
  constructor(message: string) {
    super('DOWNLOAD_INVALID', message, { recovery: { stage: 'verify', lastCompletedStage: 'download' } });
  }
}

const signatures: Record<SupportedDownloadMediaType, Buffer> = {
  'application/pdf': Buffer.from('%PDF-'),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': Buffer.from([
    0x50, 0x4b, 0x03, 0x04,
  ]),
};

export async function validateDownloadedFile(
  path: string,
  mediaType: SupportedDownloadMediaType,
  expectedBusinessLabel?: string,
  requiredWorkbookLabels: readonly string[] = [],
): Promise<FileDescriptor> {
  await chmod(path, 0o600);
  const bytes = await readFile(path);
  const fileStat = await stat(path);
  const signature = signatures[mediaType];
  if (fileStat.size <= signature.length || !bytes.subarray(0, signature.length).equals(signature)) {
    throw new DownloadValidationError('Downloaded content did not match its declared document type.');
  }
  if (mediaType.includes('spreadsheetml')) {
    await validateWorkbook(bytes, expectedBusinessLabel, requiredWorkbookLabels);
  }
  return {
    path,
    mediaType,
    byteCount: fileStat.size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function normalizeIdentity(value: string): string {
  return value.normalize('NFKD').replace(/[^a-z0-9]+/giu, '').toLowerCase();
}

async function validateWorkbook(
  bytes: Buffer,
  expectedBusinessLabel?: string,
  requiredLabels: readonly string[] = [],
): Promise<void> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  } catch {
    throw new DownloadValidationError('Downloaded spreadsheet archive is invalid.');
  }
  const required = ['[Content_Types].xml', 'xl/workbook.xml'];
  const hasWorksheet = Object.keys(zip.files).some((name) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name));
  if (!required.every((name) => zip.file(name) !== null) || !hasWorksheet) {
    throw new DownloadValidationError('Downloaded archive is not an XLSX workbook.');
  }
  let normalizedXml = '';
  if (expectedBusinessLabel !== undefined || requiredLabels.length > 0) {
    const xmlNames = Object.keys(zip.files).filter((name) => name.endsWith('.xml'));
    const xml = (await Promise.all(xmlNames.map(async (name) => zip.file(name)?.async('string') ?? ''))).join('');
    normalizedXml = normalizeIdentity(xml);
    for (const label of requiredLabels) {
      const marker = normalizeIdentity(label);
      if (marker.length < 4 || !normalizedXml.includes(marker)) {
        throw new DownloadValidationError('Downloaded workbook does not match the expected spreadsheet schema.');
      }
    }
  }
  if (expectedBusinessLabel !== undefined) {
    const marker = normalizeIdentity(expectedBusinessLabel);
    if (marker.length < 4) {
      throw new DownloadValidationError('Expected business identity is not specific enough.');
    }
    if (!normalizedXml.includes(marker)) {
      throw new DownloadValidationError('Downloaded workbook does not match the selected business.');
    }
  }
}
