import type { Page } from 'playwright';
import { z } from 'zod';
import { PortalError } from '../../../../packages/runtime/src/errors.js';

const CONTRACT = 'services/bancochile-personas/docs/contracts/cuentas-movimientos.md';
const productsUrl = '/mibancochile/rest/persona/selectorproductos/selectorProductos/obtenerProductos';
const balancesUrl = '/mibancochile/rest/persona/bff-pp-prod-ctas-saldos/productos/cuentas/saldos';

const product = z.object({ tipo: z.string(), codigo: z.string(), codigoMoneda: z.string(), label: z.string(), mascara: z.string(), numero: z.string(), estado: z.string() });
const products = z.object({ productos: z.array(product) });
const balances = z.array(z.object({
  tipo: z.string(), codProducto: z.string(), descripcion: z.string(), moneda: z.string(), numero: z.string(),
  disponible: z.number(),
}));

export interface OwnAccount {
  /** Account number as the portal lists it; the selector for movements. */
  number: string;
  /** Portal product type, e.g. CUENTA_CORRIENTE or LINEA_CREDITO. */
  type: string;
  productCode: string;
  label: string;
  currency: string;
  status: string | null;
  available: number;
}

/** Reads JSON from an observed same-origin GET inside the authenticated page (cookies only). */
export async function getJson(page: Page, path: string, contractRef: string): Promise<unknown> {
  return page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: 'include', headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`status ${String(response.status)}`);
    return response.json() as Promise<unknown>;
  }, path).catch(() => {
    throw new PortalError('PROVIDER_ERROR', 'The portal did not return the requested data.', { recovery: { stage: 'navigate', contractRef } });
  });
}

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new PortalError('CONTRACT_MISMATCH', `Contract mismatch: the ${what} response changed at ${issue?.path.join('.') ?? '<root>'}.`, { recovery: { stage: 'parse', contractRef: CONTRACT } });
  }
  return parsed.data;
}

/** Own accounts are the products with a balance (current accounts, credit lines), described by the product list. */
export function accountsFrom(productsBody: unknown, balancesBody: unknown): OwnAccount[] {
  const known = parse(products, productsBody, 'product list').productos;
  return parse(balances, balancesBody, 'balances').map((item) => {
    const description = known.find((entry) => entry.numero === item.numero);
    return {
      number: item.numero, type: item.tipo, productCode: item.codProducto, label: description?.label.trim() ?? item.descripcion,
      currency: item.moneda, status: description?.estado ?? null, available: item.disponible,
    };
  });
}

export async function readAccounts(page: Page): Promise<OwnAccount[]> {
  return accountsFrom(await getJson(page, productsUrl, CONTRACT), await getJson(page, balancesUrl, CONTRACT));
}
