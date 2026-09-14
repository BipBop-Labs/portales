import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { validateDownloadedFile } from '../src/downloads.js';

describe('download validation', () => {
  it('accepts a non-empty PDF with the declared signature', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'portales-synthetic-'));
    const path = join(directory, 'cartola.pdf');
    await writeFile(path, Buffer.from('%PDF-1.7\nsynthetic document body'));

    const descriptor = await validateDownloadedFile(path, 'application/pdf');

    expect(descriptor.byteCount).toBeGreaterThan(8);
    expect(descriptor.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, 'utf8')).toContain('synthetic');
  });

  it('rejects HTML disguised as an Excel download', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'portales-synthetic-'));
    const path = join(directory, 'cartola.xlsx');
    await writeFile(path, Buffer.from('<html>synthetic login wall</html>'));

    await expect(
      validateDownloadedFile(
        path,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).rejects.toMatchObject({ code: 'PORTAL_CHANGED' });
  });

  it('rejects a ZIP that is not an XLSX workbook', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'portales-synthetic-'));
    const path = join(directory, 'cartola.xlsx');
    const zip = new JSZip();
    zip.file('unrelated.txt', 'synthetic');
    await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));

    await expect(validateDownloadedFile(
      path,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Synthetic Business',
    )).rejects.toMatchObject({ code: 'PORTAL_CHANGED' });
  });

  it('requires the expected business identity inside an XLSX', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'portales-synthetic-'));
    const path = join(directory, 'cartola.xlsx');
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('xl/workbook.xml', '<workbook/>');
    zip.file('xl/worksheets/sheet1.xml', '<sheet>Synthetic Business</sheet>');
    await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));

    await expect(validateDownloadedFile(
      path,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Different Business',
    )).rejects.toMatchObject({ code: 'PORTAL_CHANGED' });
  });

  it('requires configured semantic labels inside an XLSX', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'portales-synthetic-'));
    const path = join(directory, 'cartola.xlsx');
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('xl/workbook.xml', '<workbook/>');
    zip.file('xl/worksheets/sheet1.xml', '<sheet>Unrelated workbook</sheet>');
    await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));

    await expect(validateDownloadedFile(
      path,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      undefined,
      ['Fecha de transacción', 'Saldo contable'],
    )).rejects.toMatchObject({ code: 'PORTAL_CHANGED' });
  });
});
