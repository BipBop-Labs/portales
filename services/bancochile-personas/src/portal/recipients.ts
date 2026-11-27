import type { Page, Response } from 'playwright';
import { z } from 'zod';
import { PortalError } from '../../../../packages/runtime/src/errors.js';
import { canonicalRut } from '../../../../packages/runtime/src/rut.js';
import { appUrl } from './session.js';

const CONTRACT = 'services/bancochile-personas/docs/contracts/destinatarios.md';
const endpoint = '/mibancochile/rest/persona/bff-pper-srv-tnsf-agenda/agenda/beneficiarios';

const account = z.object({
  identificadorCuenta: z.string(),
  banco: z.string(),
  codigoBanco: z.string(),
  nombreTipoCuenta: z.string(),
  nroCuenta: z.string(),
  alias: z.string().nullable(),
  email: z.string().nullable(),
  esFavorito: z.boolean(),
});
const beneficiary = z.object({
  id: z.number(),
  nombreRazonSocial: z.string(),
  rutBeneficiario: z.string(),
  fechaCreacion: z.string().nullable(),
  cuentas: z.array(account),
});
const page = z.object({
  beneficiarios: z.array(beneficiary),
  /** Paged by accounts, not recipients: `paginas` is the current page and `totalItems` counts accounts. */
  pagina: z.object({ masPaginas: z.boolean(), paginas: z.number(), totalItems: z.number() }),
});
type AgendaPage = z.infer<typeof page>;

export interface RecipientAccount {
  accountId: string;
  bank: string;
  bankCode: string;
  accountType: string;
  accountNumber: string;
  alias: string | null;
  email: string | null;
  favorite: boolean;
}

export interface Recipient {
  id: string;
  name: string;
  /** Canonical `12345678-9` when valid; the portal's text otherwise. */
  rut: string;
  createdAt: string | null;
  accounts: RecipientAccount[];
}

function parsePage(value: unknown): AgendaPage {
  const parsed = page.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new PortalError('CONTRACT_MISMATCH', `Contract mismatch: the recipient agenda response changed at ${issue?.path.join('.') ?? '<root>'}.`, {
      recovery: { stage: 'parse', contractRef: CONTRACT, nextCommand: 'portales bancochile-personas destinatarios list --profile <profile>' },
    });
  }
  return parsed.data;
}

/** Agenda pages are cut by accounts, so one recipient's accounts may continue on the next page.
 *  Merges by recipient ID in portal order and checks the account count the portal reported. */
export function recipientsFromPages(bodies: unknown[]): Recipient[] {
  const pages = bodies.map(parsePage);
  const byId = new Map<string, Recipient>();
  for (const item of pages.flatMap((entry) => entry.beneficiarios)) {
    const id = String(item.id);
    const recipient = byId.get(id) ?? { id, name: item.nombreRazonSocial, rut: canonicalRut(item.rutBeneficiario) ?? item.rutBeneficiario.trim(), createdAt: item.fechaCreacion, accounts: [] };
    for (const entry of item.cuentas) {
      if (recipient.accounts.some((known) => known.accountId === entry.identificadorCuenta)) continue;
      recipient.accounts.push({
        accountId: entry.identificadorCuenta, bank: entry.banco, bankCode: entry.codigoBanco, accountType: entry.nombreTipoCuenta,
        accountNumber: entry.nroCuenta, alias: entry.alias, email: entry.email, favorite: entry.esFavorito,
      });
    }
    byId.set(id, recipient);
  }
  const recipients = [...byId.values()];
  const accounts = recipients.reduce((total, item) => total + item.accounts.length, 0);
  const expected = pages[0]?.pagina.totalItems ?? 0;
  if (accounts !== expected) {
    throw new PortalError('CONTRACT_MISMATCH', `Contract mismatch: the agenda reported ${String(expected)} accounts and ${String(accounts)} were read.`, {
      recovery: { stage: 'verify', contractRef: CONTRACT },
    });
  }
  return recipients;
}

const pageNumber = (url: string) => Number(new URL(url).searchParams.get('pagina'));

/** Opens the agenda route and reads the pages its own UI requests; any page the UI did not
 *  request is fetched once inside the same authenticated page with the observed parameters. */
export async function readRecipients(browser: Page): Promise<Recipient[]> {
  const responses = new Map<number, Promise<unknown>>();
  let template: URL | undefined;
  const listener = (response: Response) => {
    const url = new URL(response.url());
    if (url.pathname !== endpoint || response.request().method() !== 'GET') return;
    if (response.status() !== 200) return;
    template ??= url;
    responses.set(pageNumber(response.url()), response.json().catch(() => undefined));
  };
  browser.on('response', listener);
  try {
    await browser.goto(`${appUrl}#/tef/transferencia-electronica/agenda`, { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + 30_000;
    while (!responses.has(1) && Date.now() < deadline) await browser.waitForTimeout(250);
    if (!responses.has(1) || template === undefined) {
      throw new PortalError('READINESS_TIMEOUT', 'The recipient agenda did not load its first page.', { recovery: { stage: 'navigate', contractRef: CONTRACT } });
    }
    await browser.waitForTimeout(2_000);
  } finally {
    browser.off('response', listener);
  }
  const pages: unknown[] = [];
  const maxPages = 50;
  for (let number = 1; number <= maxPages; number += 1) {
    let body = await responses.get(number);
    if (body === undefined) {
      const url = new URL(template.href);
      url.searchParams.set('pagina', String(number));
      body = await browser.evaluate(async (href) => {
        const response = await fetch(href, { credentials: 'include', headers: { accept: 'application/json' } });
        if (!response.ok) throw new Error(`status ${String(response.status)}`);
        return response.json() as Promise<unknown>;
      }, url.href).catch(() => {
        throw new PortalError('PROVIDER_ERROR', `The recipient agenda page ${String(number)} could not be read.`, { recovery: { stage: 'navigate', contractRef: CONTRACT } });
      });
    }
    const current = parsePage(body);
    pages.push(body);
    if (!current.pagina.masPaginas) break;
    if (number === maxPages) {
      throw new PortalError('CONTRACT_MISMATCH', `Contract mismatch: the recipient agenda still reported more pages after ${String(maxPages)}.`, { recovery: { stage: 'verify', contractRef: CONTRACT } });
    }
  }
  return recipientsFromPages(pages);
}

