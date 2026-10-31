import type { Locator, Page, Response } from 'playwright';
import { PortalError } from '../../../../packages/runtime/src/errors.js';
import { appUrl } from './session.js';

const CONTRACT = 'services/bancochile-personas/docs/contracts/transferencias.md';
const orchestrator = '/nueva-tef-rest/nueva-tef/ofd/orquestadorTefEncrypted/nivel1';
/** The challenge expired after about three minutes when observed; wait a little longer. */
const APPROVAL_WAIT_MS = 5 * 60_000;

export interface TransferOrder {
  originNumber: string;
  accountNumber: string;
  bank: string;
  amount: number;
  message: string;
}

export type TransferProgress = (stage: 'awaiting-mipass' | 'verifying-mipass') => void;

const digits = (value: string) => value.replace(/\D/gu, '').replace(/^0+/u, '');
const clp = (amount: number) => `$ ${amount.toLocaleString('es-CL')}`;

/** True when some number in the bank's summary is exactly the account number (separators and
 *  leading zeros ignored). Column order in the summary text is not relied on. */
export function summaryShowsAccount(summary: string, accountNumber: string): boolean {
  return (summary.match(/\d[\d.-]{4,}\d/gu) ?? []).some((token) => digits(token) === digits(accountNumber));
}

const changed = (message: string) => new PortalError('CONTRACT_MISMATCH', `Contract mismatch: ${message} Nothing was submitted.`, {
  recovery: { stage: 'navigate', contractRef: CONTRACT, remoteMutationPossible: false },
});
const ambiguous = (message: string) => new PortalError('REMOTE_STATE_AMBIGUOUS', message, {
  recovery: { stage: 'verify', contractRef: CONTRACT, remoteMutationPossible: true, nextCommand: 'portales bancochile-personas movimientos list --profile <profile> --account <origin>' },
});

async function exactlyOne(locator: Locator, description: string): Promise<Locator> {
  await locator.first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);
  const count = await locator.count();
  if (count !== 1) throw changed(`expected exactly one ${description}, observed ${String(count)}.`);
  return locator.first();
}

async function bankMessage(reply: Response): Promise<string> {
  const body = await reply.json().catch(() => null) as { mensaje?: unknown } | null;
  return typeof body?.mensaje === 'string' ? body.mensaje.slice(0, 200) : 'no message';
}

/** Fills the third-party transfer form, checks the bank's own summary against the order, clicks
 *  CONFIRMAR once and, when the bank asks for it, the Mi Pass control once. Returns when the bank
 *  answered the approved transfer with 200. Nothing is retried. */
export async function transfer(page: Page, order: TransferOrder, progress: TransferProgress): Promise<{ miPass: boolean }> {
  await page.goto(`${appUrl}#/tef/transferencia-electronica/transferencia-terceros`, { waitUntil: 'domcontentloaded' });
  const destination = await exactlyOne(page.locator('mat-form-field').filter({ has: page.locator('mat-label', { hasText: /^Destinatario$/u }) }).locator('input'), 'recipient search field');
  const immediate = await exactlyOne(page.locator('mat-radio-button').filter({ hasText: /^\s*Inmediata\s*$/u }), 'Inmediata option');
  if (!(await immediate.getAttribute('class') ?? '').includes('mat-radio-checked')) throw changed('the immediate transfer option is not selected by default.');
  const origin = await exactlyOne(page.locator('mat-select[placeholder="Cuenta de cargo"]'), 'origin account selector');
  if (digits(await origin.innerText()) !== digits(order.originNumber)) throw changed('the selected origin account is not the requested one.');

  // Searching the full account number left exactly one option, labelled alias and bank (observed 2026-10-31).
  await destination.click();
  await destination.pressSequentially(order.accountNumber, { delay: 40 });
  const options = page.locator('.cdk-overlay-pane mat-option');
  await options.first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
  if (await options.count() !== 1) throw changed(`searching the account number should leave one recipient option, observed ${String(await options.count())}.`);
  const option = options.first();
  if (!(await option.innerText()).toLocaleLowerCase('es-CL').includes(order.bank.toLocaleLowerCase('es-CL'))) throw changed('the only recipient option is not of the expected bank.');
  await option.click();

  await (await exactlyOne(page.locator('input[formcontrolname="monto"]'), 'amount field')).fill(String(order.amount));
  await (await exactlyOne(page.locator('textarea[formcontrolname="mensaje"]'), 'message field')).fill(order.message);
  await page.waitForTimeout(1_500);

  // The bank's own summary must show the requested destination account and amount before CONFIRMAR.
  const summary = await exactlyOne(page.locator('div, section').filter({ hasText: /^Origen/u }).filter({ hasText: 'Cuenta de destino' }).last(), 'confirmation summary');
  const text = await summary.innerText();
  if (!summaryShowsAccount(text, order.accountNumber)) throw changed('the confirmation summary does not show the requested destination account.');
  if (!text.includes(clp(order.amount))) throw changed('the confirmation summary shows another amount.');

  const answers: Response[] = [];
  const listener = (reply: Response) => {
    if (reply.request().method() === 'POST' && new URL(reply.url()).pathname.endsWith(orchestrator)) answers.push(reply);
  };
  page.on('response', listener);
  try {
    const next = async (seen: number, timeout: number): Promise<Response | undefined> => {
      const deadline = Date.now() + timeout;
      while (answers.length <= seen && Date.now() < deadline) {
        if (await page.getByText(/El env[ií]o de Mi Pass no ha sido posible/u).count() > 0) {
          throw new PortalError('ADDITIONAL_AUTH_REQUIRED', 'Mi Pass was not approved before the challenge expired. Nothing was transferred.', {
            recovery: { stage: 'verify', contractRef: CONTRACT, remoteMutationPossible: false },
          });
        }
        await page.waitForTimeout(500);
      }
      return answers[seen];
    };
    await (await exactlyOne(page.locator('button').filter({ hasText: /^\s*CONFIRMAR\s*$/u }).filter({ visible: true }), 'CONFIRMAR button')).click();
    const first = await next(0, 30_000);
    if (first === undefined) throw ambiguous('CONFIRMAR was clicked but the bank did not answer.');
    if (first.status() === 200) return { miPass: false };
    if (first.status() !== 401) {
      throw new PortalError('PROVIDER_ERROR', `The bank rejected the transfer: ${await bankMessage(first)}`, { recovery: { stage: 'verify', contractRef: CONTRACT, remoteMutationPossible: false } });
    }
    const authorize = await exactlyOne(page.locator('label.mi-pass-box').filter({ hasText: /AUTORIZA CON MI PASS/iu }).filter({ visible: true }), 'AUTORIZA CON MI PASS control')
      .catch(() => { throw new PortalError('AUTHORIZATION_DENIED', 'The bank did not offer Mi Pass for this transfer. Nothing was transferred.', { recovery: { stage: 'verify', contractRef: CONTRACT, remoteMutationPossible: false } }); });
    await authorize.click();
    progress('awaiting-mipass');
    const approved = await next(1, APPROVAL_WAIT_MS);
    progress('verifying-mipass');
    if (approved === undefined) throw ambiguous('Mi Pass was requested but no approved transfer was observed in time.');
    if (approved.status() === 200) return { miPass: true };
    throw new PortalError('PROVIDER_ERROR', `The bank rejected the approved transfer: ${await bankMessage(approved)}`, {
      recovery: { stage: 'verify', contractRef: CONTRACT, remoteMutationPossible: true, nextCommand: 'portales bancochile-personas movimientos list --profile <profile> --account <origin>' },
    });
  } finally {
    page.off('response', listener);
  }
}
