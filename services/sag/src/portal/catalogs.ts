import { chromium, type Route } from 'playwright';
import { z } from 'zod';
import { PortalError } from '../../../bci-pyme/src/errors.js';

const documentUrl = 'https://dj.sag.gob.cl/declaracion-jurada';
const apiOrigin = 'https://djapi.sag.gob.cl';
const paths = {
  countries: '/paises',
  genders: '/generos',
  documents: '/documentosViaje',
  entryModes: '/tiposControlFronterizo',
  transports: '/tiposTransportes',
  borderControls: '/controlesFronterizos',
  transportLinks: '/controlesFronterizos/controlFronterizoTipoTransporte',
} as const;
const allowedUrls = new Set([documentUrl, ...Object.values(paths).map(path => apiOrigin + path)]);
const id = z.number().int().positive().transform(String);
const label = z.string().trim().min(1);
const named = z.object({ id, nombreEsp: label }).transform(item => ({ id: item.id, label: item.nombreEsp }));
const schemas = {
  countries: z.array(named).min(1),
  genders: z.array(named).min(1),
  documents: z.array(named).min(1),
  entryModes: z.array(named).min(1),
  transports: z.array(named).min(1),
  borderControls: z.array(z.object({
    id, nombre: label, estaActivo: z.boolean(), tipoControlFronterizoId: id,
    diasAnticipacion: z.number().int().min(1).max(366), tipoDeclaracionId: id,
  }).transform(item => ({
    id: item.id, label: item.nombre, active: item.estaActivo, entryMode: item.tipoControlFronterizoId,
    advanceDays: item.diasAnticipacion, declarationType: item.tipoDeclaracionId,
  }))).min(1),
  transportLinks: z.array(z.object({ controlFronterizoId: id, tipoTransporteId: id }).transform(item => ({
    borderControl: item.controlFronterizoId, transportType: item.tipoTransporteId,
  }))).min(1),
};
export type SagCatalogs = { [K in keyof typeof schemas]: z.output<(typeof schemas)[K]> };

function changed(): PortalError {
  return new PortalError('PORTAL_CHANGED', 'SAG catalog discovery changed or failed. Inspect the options contract before another live attempt.');
}

/** Loading the normal application can create a draft. Only observed read URLs may leave this context. */
export async function routeCatalogRead(route: Route): Promise<void> {
  const request = route.request();
  if (request.method() === 'GET' && allowedUrls.has(request.url())) await route.continue();
  else await route.abort('blockedbyclient');
}

function parseCatalogs(raw: Record<string, unknown>): SagCatalogs {
  const result = z.object(schemas).safeParse(raw);
  if (!result.success) throw changed();
  const catalogs = result.data;
  for (const values of [catalogs.countries, catalogs.genders, catalogs.documents,
    catalogs.entryModes, catalogs.transports, catalogs.borderControls]) {
    if (new Set(values.map(value => value.id)).size !== values.length) throw changed();
  }
  const modes = new Set(catalogs.entryModes.map(item => item.id));
  const controls = new Set(catalogs.borderControls.map(item => item.id));
  const transports = new Set(catalogs.transports.map(item => item.id));
  if (catalogs.borderControls.some(item => !modes.has(item.entryMode))
    || catalogs.transportLinks.some(item => !controls.has(item.borderControl) || !transports.has(item.transportType))) {
    throw changed();
  }
  return catalogs;
}

/** Reads and curates all observed catalogs without executing the application or persisting browser state. */
export async function readSagCatalogs(): Promise<SagCatalogs> {
  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => {
    throw new PortalError('PORTAL_CHANGED', 'SAG browser could not start. Verify Chrome is installed and browser execution is permitted before another attempt.');
  });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
    await context.route('**/*', routeCatalogRead);
    const page = await context.newPage();
    const response = await page.goto(documentUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    checkStatus(response?.status() ?? 0);
    if (page.url() !== documentUrl || await page.title() !== 'SAG: Declaración Jurada') throw changed();
    const raw: Record<string, unknown> = {};
    for (const [key, path] of Object.entries(paths)) {
      // Playwright evaluation works with page scripts disabled. Fetch keeps the observed browser origin.
      const response = await page.evaluate(async url => {
        const result = await fetch(url, {
          headers: { Accept: 'application/json, text/plain, */*' },
          redirect: 'error', signal: AbortSignal.timeout(30_000),
        });
        return {
          status: result.status,
          contentType: result.headers.get('content-type'),
          body: result.ok ? await result.text() : null,
        };
      }, apiOrigin + path);
      checkStatus(response.status);
      if (!response.contentType?.startsWith('application/json') || response.body === null) throw changed();
      const body: unknown = JSON.parse(response.body);
      const envelope = z.object({ status: z.literal(200), data: z.unknown() }).safeParse(body);
      if (!envelope.success) throw changed();
      if (!schemas[key as keyof typeof schemas].safeParse(envelope.data.data).success) throw changed();
      raw[key] = envelope.data.data;
    }
    return parseCatalogs(raw);
  } catch (error: unknown) {
    if (error instanceof PortalError) throw error;
    throw changed();
  } finally {
    await browser.close();
  }
}

function checkStatus(status: number): void {
  if (status === 401 || status === 403) {
    throw new PortalError('AUTHORIZATION_DENIED', 'SAG denied public catalog access. Stop and resolve access before another attempt.');
  }
  if (status === 429) throw new PortalError('RATE_LIMITED', 'SAG rate limited catalog access. Stop; do not retry automatically.');
  if (status !== 200) throw changed();
}
