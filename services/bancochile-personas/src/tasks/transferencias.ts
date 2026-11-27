import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PortalError, invalidInput } from '../../../../packages/runtime/src/errors.js';
import { requireSafeProfile } from '../../../../packages/runtime/src/login-breaker.js';
import type { OwnAccount } from '../portal/accounts.js';
import type { Movement } from '../portal/movements.js';
import type { Recipient, RecipientAccount } from '../portal/recipients.js';
import type { TransferOrder, TransferProgress } from '../portal/transfer.js';

export interface TransferPortal {
  listRecipients(): Promise<Recipient[]>;
  listAccounts(): Promise<OwnAccount[]>;
  listMovements(accountNumber: string, range: null): Promise<{ currency: string; movements: Movement[] }>;
  transfer(order: TransferOrder, progress: TransferProgress): Promise<{ miPass: boolean }>;
}

export interface TransferInput { recipientId: string; accountId: string; amount: number; message: string }

/** The form's message field shows a 50-character counter (observed 2026-10-31). */
export const MAX_MESSAGE = 50;

/** Local checks before any browser: whole CLP of at least 1 and a short message. */
export function validateTransfer(input: { recipientId?: unknown; accountId?: unknown; amount?: unknown; message?: unknown }): TransferInput {
  const amount = typeof input.amount === 'string' && /^\d+$/u.test(input.amount) ? Number(input.amount) : Number.NaN;
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw invalidInput('--amount must be a whole number of pesos, at least 1.', [{ field: '--amount', expected: 'integer ≥ 1 (CLP, no separators)' }]);
  }
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (message.length > MAX_MESSAGE) throw invalidInput(`--message must have at most ${String(MAX_MESSAGE)} characters.`, [{ field: '--message', expected: `≤ ${String(MAX_MESSAGE)} characters` }]);
  if (typeof input.recipientId !== 'string' || typeof input.accountId !== 'string') {
    throw invalidInput('--recipient-id and --account-id are required.', [{ field: '--account-id', expected: 'account ID', discoverWith: 'portales bancochile-personas destinatarios show --profile <profile> --name <words>' }]);
  }
  return { recipientId: input.recipientId, accountId: input.accountId, amount, message };
}

/** Private, owner-set cap outside the repository: `{"version":1,"maxTransferAmount":<CLP>}`. */
export function transferLimitPath(configRoot: string): string {
  return join(configRoot, 'portales', 'bancochile-personas.json');
}

/** Reads the owner's per-transfer cap. Fails closed: without a readable cap that only its owner can
 *  change, no transfer is prepared or created. The bank's Mi Pass decision is risk-based and made
 *  after CONFIRMAR, so this local cap is the only limit known before money can move. */
export async function readTransferLimit(configRoot: string): Promise<number> {
  const path = transferLimitPath(configRoot);
  const missing = () => invalidInput(`Transfers need a per-transfer cap in ${path}.`, [{ field: 'maxTransferAmount', expected: `{"version":1,"maxTransferAmount":<whole CLP>} in ${path}, mode 0600` }], {
    nextAction: `The account owner creates ${path} with mode 0600; agents never raise it.`,
  });
  let text: string;
  try {
    if (((await stat(path)).mode & 0o022) !== 0) throw missing();
    text = await readFile(path, 'utf8');
  } catch (error: unknown) {
    if (error instanceof PortalError) throw error;
    throw missing();
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw missing(); }
  const item = parsed as { version?: unknown; maxTransferAmount?: unknown } | null;
  if (item?.version !== 1 || typeof item.maxTransferAmount !== 'number' || !Number.isSafeInteger(item.maxTransferAmount) || item.maxTransferAmount < 1) throw missing();
  return item.maxTransferAmount;
}

/** Local check before any browser: reads the cap and refuses an order above it. Returns the cap,
 *  which prepare and create enforce again. */
export async function checkTransferLimit(order: TransferInput, configRoot: string): Promise<number> {
  const maxAmount = await readTransferLimit(configRoot);
  requireWithinLimit(order, maxAmount);
  return maxAmount;
}

function requireWithinLimit(order: TransferInput, maxAmount: number): void {
  if (order.amount > maxAmount) {
    throw invalidInput(`The amount exceeds the configured per-transfer cap of ${String(maxAmount)} CLP.`, [{ field: '--amount', expected: `≤ ${String(maxAmount)}` }], {
      nextAction: 'Do not split the transfer to fit the cap; ask the account owner. Agents never raise the cap.',
    });
  }
}

const mask = (value: string) => `••••${value.slice(-4)}`;

async function resolve(input: { profile: string; order: TransferInput }, portal: TransferPortal) {
  const recipient = (await portal.listRecipients()).find((item) => item.id === input.order.recipientId);
  const account = recipient?.accounts.find((item) => item.accountId === input.order.accountId);
  if (recipient === undefined || account === undefined) {
    throw new PortalError('INVALID_INPUT', 'No such recipient account in the agenda.', {
      recovery: { nextCommand: `portales bancochile-personas destinatarios show --profile ${input.profile} --id <recipient-id>` },
    });
  }
  // The form's default origin is the current account; other origins are not supported yet.
  const origin = (await portal.listAccounts()).find((item) => item.type === 'CUENTA_CORRIENTE');
  if (origin === undefined) throw new PortalError('UNSUPPORTED_CAPABILITY', 'No current account to transfer from.');
  if (input.order.amount > origin.available) {
    throw invalidInput('The amount exceeds the available balance of the current account.', [{ field: '--amount', expected: `≤ ${String(origin.available)}` }]);
  }
  return { recipient, account, origin };
}

/** Binds the confirmation to the profile, the order, and the destination and origin as they are now. */
function confirmation(profile: string, order: TransferInput, account: RecipientAccount, origin: OwnAccount): string {
  return createHash('sha256').update(JSON.stringify([profile, order, account.accountNumber, account.bankCode, origin.number])).digest('hex').slice(0, 16);
}

function preview(order: TransferInput, recipient: Recipient, account: RecipientAccount, origin: OwnAccount) {
  return {
    effect: 'destructive' as const, authorization: 'Mi Pass',
    origin: { label: origin.label, accountNumber: mask(origin.number), available: origin.available, currency: origin.currency },
    destination: { recipientId: recipient.id, name: recipient.name, rut: recipient.rut, accountId: account.accountId, bank: account.bank, accountType: account.accountType, accountNumber: mask(account.accountNumber), alias: account.alias },
    amount: order.amount, currency: 'CLP', message: order.message, when: 'immediate' as const,
  };
}

/** Changes nothing: checks the order against the live agenda and balance and returns the preview. */
export async function prepareTransfer(input: { profile: string; order: TransferInput; maxAmount: number }, portal: TransferPortal) {
  requireSafeProfile(input.profile);
  requireWithinLimit(input.order, input.maxAmount);
  const { recipient, account, origin } = await resolve(input, portal);
  const code = confirmation(input.profile, input.order, account, origin);
  const message = input.order.message === '' ? '' : ` --message '${input.order.message.replace(/'/gu, "'\\''")}'`;
  return {
    preview: preview(input.order, recipient, account, origin), confirmation: code,
    nextCommand: `portales bancochile-personas transferencias create --profile ${input.profile} --recipient-id ${recipient.id} --account-id ${account.accountId} --amount ${String(input.order.amount)}${message} --confirm ${code}`,
  };
}

/** The debit a completed transfer adds to the origin's default movements view: a new movement ID,
 *  a debit of exactly the amount. Several candidates are not resolved by guessing. */
export function newDebit(before: Set<string>, after: Movement[], amount: number): Movement | 'none' | 'several' {
  const candidates = after.filter((item) => !before.has(item.id) && item.direction === 'debit' && item.amount === amount);
  return candidates.length === 1 ? candidates[0] as Movement : candidates.length === 0 ? 'none' : 'several';
}

/** Executes one prepared transfer once and verifies the debit in the origin's movements. */
export async function createTransfer(input: { profile: string; order: TransferInput; maxAmount: number; confirm: string; progress?: TransferProgress }, portal: TransferPortal) {
  requireSafeProfile(input.profile);
  requireWithinLimit(input.order, input.maxAmount);
  const { recipient, account, origin } = await resolve(input, portal);
  if (confirmation(input.profile, input.order, account, origin) !== input.confirm) {
    throw new PortalError('CONFIRMATION_REQUIRED', 'The confirmation does not match this transfer or the destination changed since prepare. Prepare again.', {
      recovery: { nextCommand: `portales bancochile-personas transferencias prepare --profile ${input.profile} --recipient-id ${input.order.recipientId} --account-id ${input.order.accountId} --amount ${String(input.order.amount)}` },
    });
  }
  const before = new Set((await portal.listMovements(origin.number, null)).movements.map((item) => item.id));
  const { miPass } = await portal.transfer({
    originNumber: origin.number, accountNumber: account.accountNumber, bank: account.bank, amount: input.order.amount, message: input.order.message,
  }, input.progress ?? (() => undefined));
  const reconcile = `portales bancochile-personas movimientos list --profile ${input.profile} --account ${origin.number}`;
  // The bank already answered the transfer: a failing verification read must not report not-sent.
  const after = await portal.listMovements(origin.number, null).catch((error: unknown) => {
    throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'The bank answered the transfer, but the movements could not be read to verify it. Inspect the movements before anything else; never repeat the transfer.', {
      recovery: { stage: 'verify', writeOutcome: 'may-have-applied', nextCommand: reconcile }, cause: error,
    });
  });
  const debit = newDebit(before, after.movements, input.order.amount);
  if (typeof debit === 'string') {
    throw new PortalError('REMOTE_STATE_AMBIGUOUS', debit === 'none'
      ? 'The bank confirmed the transfer, but no matching debit appears in the movements yet. Inspect the movements before anything else; never repeat the transfer.'
      : 'Several new debits of this amount appear in the movements. Inspect them before anything else; never repeat the transfer.', {
      recovery: { stage: 'verify', writeOutcome: 'may-have-applied', nextCommand: reconcile },
    });
  }
  return { outcome: 'transferred' as const, miPass, preview: preview(input.order, recipient, account, origin), debit };
}
