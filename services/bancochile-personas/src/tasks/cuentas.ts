import { PortalError, invalidInput } from '../../../../packages/runtime/src/errors.js';
import { requireSafeProfile } from '../../../../packages/runtime/src/login-breaker.js';
import type { OwnAccount } from '../portal/accounts.js';
import { MAX_RANGE_DAYS, type Movement } from '../portal/movements.js';

export interface AccountsPortal {
  listAccounts(): Promise<OwnAccount[]>;
  listMovements(accountNumber: string, range: { from: string; to: string } | null): Promise<{ currency: string; movements: Movement[] }>;
}

/** The client's own accounts with their available balance. Values are private. */
export async function listCuentas(input: { profile: string }, portal: AccountsPortal) {
  requireSafeProfile(input.profile);
  return { accounts: await portal.listAccounts() };
}

const DAY = 86_400_000;
const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/u.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
const chileToday = (now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(now);
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** Validates a movements range locally: YYYY-MM-DD accounting dates, from ≤ to, at most 45 days
 *  apart. No dates means the portal's own default view (null), which also shows movements already
 *  made that post on a later business day. Only --from ends the range today in Chile. */
export function movementRange(input: { from?: string; to?: string }, now = new Date()): { from: string; to: string } | null {
  if (input.from === undefined && input.to === undefined) return null;
  const to = input.to ?? chileToday(now);
  const from = input.from ?? shift(to, -MAX_RANGE_DAYS);
  for (const [field, value] of [['--from', from], ['--to', to]] as const) {
    if (!isDay(value)) throw invalidInput(`${field} must be a date YYYY-MM-DD.`, [{ field, expected: 'YYYY-MM-DD', received: value }]);
  }
  const span = (Date.parse(to) - Date.parse(from)) / DAY;
  if (span < 0) throw invalidInput('--from must not be after --to.', [{ field: '--from', expected: `on or before ${to}`, received: from }]);
  if (span > MAX_RANGE_DAYS) {
    throw invalidInput(`The portal accepts at most ${String(MAX_RANGE_DAYS)} days per query.`, [{ field: '--from', expected: `on or after ${shift(to, -MAX_RANGE_DAYS)}`, received: from }]);
  }
  return { from, to };
}

/** Movements of one own account in a date range (both days included). Values are private. */
export async function listMovimientos(input: { profile: string; account: string; from?: string; to?: string }, portal: AccountsPortal) {
  requireSafeProfile(input.profile);
  const range = movementRange(input);
  const accounts = await portal.listAccounts();
  if (!accounts.some((item) => item.number === input.account)) {
    throw new PortalError('INVALID_INPUT', 'No own account has that number.', {
      recovery: { nextCommand: `portales bancochile-personas cuentas list --profile ${input.profile}` },
    });
  }
  const { currency, movements } = await portal.listMovements(input.account, range);
  const sum = (direction: Movement['direction']) => movements.filter((item) => item.direction === direction).reduce((total, item) => total + item.amount, 0);
  return { account: input.account, range: range ?? 'portal-default', currency, total: movements.length, debits: sum('debit'), credits: sum('credit'), movements };
}
