import type { Page, Request } from 'playwright';
import { z } from 'zod';
import { PortalError } from '../../../../packages/runtime/src/errors.js';
import { appUrl } from './session.js';

const CONTRACT = 'services/bancochile-personas/docs/contracts/cuentas-movimientos.md';
const endpoint = '/mibancochile/rest/persona/bff-pper-prd-cta-movimientos/movimientos/getCartola';
/** Larger ranges make the portal answer HTTP 500 BFERR2_500 (observed 2026-10-30). */
export const MAX_RANGE_DAYS = 45;

const movement = z.object({
  id: z.string(), fechaContable: z.string(), descripcion: z.string(), canal: z.string(), tipo: z.enum(['cargo', 'abono']),
  monto: z.string(), saldo: z.string(), numeroDocumento: z.string(), detalleGlosa: z.array(z.string()),
});
const response = z.object({
  moneda: z.string(),
  movimientos: z.array(movement),
  pagina: z.array(z.object({ totalRegistros: z.string(), masPaginas: z.string() })).length(1),
});

export interface Movement {
  id: string;
  /** Accounting date, YYYY-MM-DD. */
  date: string;
  direction: 'debit' | 'credit';
  amount: number;
  balance: number;
  description: string;
  channel: string;
  details: string[];
  documentNumber: string | null;
}

const amount = (value: string) => {
  const digits = value.replace(/[^\d-]/gu, '');
  if (!/^-?\d+$/u.test(digits)) throw new PortalError('CONTRACT_MISMATCH', 'Contract mismatch: a movement amount is not an integer.', { recovery: { stage: 'parse', contractRef: CONTRACT } });
  return Number(digits);
};

const isoDate = (value: string) => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value.trim());
  if (match === null) throw new PortalError('CONTRACT_MISMATCH', 'Contract mismatch: a movement date is not dd/mm/yyyy.', { recovery: { stage: 'parse', contractRef: CONTRACT } });
  return `${match[3] as string}-${match[2] as string}-${match[1] as string}`;
};

export function movementsFrom(body: unknown): { currency: string; movements: Movement[] } {
  const parsed = response.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new PortalError('CONTRACT_MISMATCH', `Contract mismatch: the movements response changed at ${issue?.path.join('.') ?? '<root>'}.`, { recovery: { stage: 'parse', contractRef: CONTRACT } });
  }
  const { pagina, movimientos, moneda } = parsed.data;
  const page = pagina[0] as { totalRegistros: string; masPaginas: string };
  if (page.masPaginas !== 'N') {
    // A second page has not been observed yet; never return a partial list.
    throw new PortalError('UNSUPPORTED_CAPABILITY', 'The range has more movements than one portal page. Use a shorter range.', { recovery: { stage: 'parse', contractRef: CONTRACT } });
  }
  if (Number(page.totalRegistros) !== movimientos.length) {
    throw new PortalError('CONTRACT_MISMATCH', `Contract mismatch: the portal reported ${page.totalRegistros} movements and ${String(movimientos.length)} were read.`, { recovery: { stage: 'verify', contractRef: CONTRACT } });
  }
  return {
    currency: moneda,
    movements: movimientos.map((item) => ({
      id: item.id, date: isoDate(item.fechaContable), direction: item.tipo === 'cargo' ? 'debit' : 'credit',
      amount: amount(item.monto), balance: amount(item.saldo), description: item.descripcion.trim(), channel: item.canal.trim(),
      details: item.detalleGlosa.map((line) => line.trim()).filter(Boolean),
      documentNumber: item.numeroDocumento.trim() === '' ? null : item.numeroDocumento.trim(),
    })),
  };
}

/** Midnight of a calendar day in Chile, as the ISO instant the portal's date filter sends. */
export function chileMidnight(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(year, month - 1, date);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
  const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(guess - (local - guess)).toISOString();
}

/** Opens the movements route, takes the request its own UI sends for the selected account, and
 *  sends it once more with the observed date filter (`cabecera.fechaInicio`/`fechaFin`), or unchanged
 *  for the portal's default view. */
export async function readMovements(page: Page, accountNumber: string, range: { from: string; to: string } | null) {
  let captured: { url: string; body: Record<string, unknown> } | undefined;
  const listener = (request: Request) => {
    if (captured !== undefined || request.method() !== 'POST' || new URL(request.url()).pathname !== endpoint) return;
    try { captured = { url: request.url(), body: JSON.parse(request.postData() ?? '') as Record<string, unknown> }; } catch { /* checked below */ }
  };
  page.on('request', listener);
  try {
    await page.goto(`${appUrl}#/movimientos/cuenta/saldos-movimientos`, { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + 30_000;
    while (captured === undefined && Date.now() < deadline) await page.waitForTimeout(250);
  } finally {
    page.off('request', listener);
  }
  if (captured === undefined) {
    throw new PortalError('READINESS_TIMEOUT', 'The movements view did not request its data.', { recovery: { stage: 'navigate', contractRef: CONTRACT } });
  }
  const selected = captured.body.cuentaSeleccionada as { numero?: unknown } | undefined;
  if (typeof selected?.numero !== 'string' || typeof captured.body.cabecera !== 'object' || captured.body.cabecera === null) {
    throw new PortalError('CONTRACT_MISMATCH', 'Contract mismatch: the movements request no longer has cuentaSeleccionada.numero and cabecera.', { recovery: { stage: 'navigate', contractRef: CONTRACT } });
  }
  if (selected.numero !== accountNumber) {
    // Selecting another account in the view has not been observed yet.
    throw new PortalError('UNSUPPORTED_CAPABILITY', 'Only the account the movements view opens with is supported so far.', { recovery: { stage: 'navigate', contractRef: CONTRACT } });
  }
  const cabecera = range === null ? captured.body.cabecera : { ...captured.body.cabecera, paginacionDesde: 1, fechaInicio: chileMidnight(range.from), fechaFin: chileMidnight(range.to) };
  const body = { ...captured.body, cabecera };
  const result = await page.evaluate(async ({ url, payload }) => {
    const reply = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload) });
    return { status: reply.status, json: await reply.json().catch(() => null) as unknown };
  }, { url: captured.url, payload: body });
  if (result.status !== 200) {
    throw new PortalError('PROVIDER_ERROR', `The portal answered the movements query with HTTP ${String(result.status)}.`, { recovery: { stage: 'navigate', contractRef: CONTRACT } });
  }
  return movementsFrom(result.json);
}
