import { chromium } from 'playwright';
import { PortalError } from '../../../bci-pyme/src/errors.js';

/** Retrieves only the observed online receipt for an already-finalized declaration. */
export async function readSagReceipt(folio: string, declarationId: string): Promise<Buffer> {
  const documentUrl = 'https://dj.sag.gob.cl/declaracion-jurada';
  const pdfUrl = `https://djapi.sag.gob.cl/declaracionJurada/${folio}/uuid/${declarationId}/pdf`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      if (route.request().method() === 'GET' && route.request().url() === documentUrl) await route.continue();
      else await route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    const document = await page.goto(documentUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    checkStatus(document?.status() ?? 0);
    if (page.url() !== documentUrl || await page.title() !== 'SAG: Declaración Jurada') throw changed();
    // APIRequestContext shares browser-managed cookies. It performs one explicit GET and cannot redirect or retry.
    const response = await context.request.get(pdfUrl, { maxRedirects: 0, maxRetries: 0, timeout: 30_000 });
    checkStatus(response.status());
    if (response.url() !== pdfUrl || response.headers()['content-type']?.split(';')[0] !== 'application/pdf') throw changed();
    const bytes = await response.body();
    if (bytes.length < 5 || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw changed();
    return bytes;
  } catch (error: unknown) {
    if (error instanceof PortalError) throw error;
    throw changed();
  } finally {
    await browser.close();
  }
}

function changed(): PortalError {
  return new PortalError('PORTAL_CHANGED', 'SAG receipt retrieval failed or changed. Inspect the receipt contract; do not submit again.');
}

function checkStatus(status: number): void {
  if (status === 401 || status === 403) throw new PortalError('AUTHORIZATION_DENIED', 'SAG denied receipt access. Stop and resolve access; do not submit again.');
  if (status === 429) throw new PortalError('RATE_LIMITED', 'SAG rate limited receipt access. Stop; do not retry automatically.');
  if (status !== 200) throw changed();
}
