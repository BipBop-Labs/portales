import { createHash } from 'node:crypto';
import { PortalError } from '../../../../packages/runtime/src/errors.js';
import { requireSafeProfile } from '../../../../packages/runtime/src/login-breaker.js';
import type { Recipient, RecipientAccount } from '../portal/recipients.js';
import type { AccountTarget, EditProgress, RecipientEdit } from '../portal/recipient-writes.js';

export type RecipientWrite =
  | { action: 'favorite'; recipientId: string; accountId: string; favorite: boolean }
  | { action: 'delete-account'; recipientId: string; accountId: string }
  | { action: 'edit'; recipientId: string; name?: string; aliases: Array<{ accountId: string; alias: string }> };

export interface RecipientWritePortal {
  listRecipients(): Promise<Recipient[]>;
  toggleFavorite(target: AccountTarget): Promise<void>;
  deleteAccount(target: AccountTarget): Promise<void>;
  editRecipient(edit: RecipientEdit, progress: EditProgress): Promise<{ miPass: boolean }>;
}

const mask = (value: string) => `••••${value.slice(-4)}`;

function notFound(profile: string): PortalError {
  return new PortalError('INVALID_INPUT', 'No such recipient or account in the agenda.', {
    recovery: { nextCommand: `portales bancochile-personas destinatarios show --profile ${profile} --id <recipient-id>` },
  });
}

/** The recipient and the accounts the write touches, read from the live agenda. */
function locate(recipients: Recipient[], write: RecipientWrite, profile: string): { recipient: Recipient; accounts: RecipientAccount[] } {
  const recipient = recipients.find((item) => item.id === write.recipientId);
  if (recipient === undefined) throw notFound(profile);
  const ids = write.action === 'edit' ? write.aliases.map((item) => item.accountId) : [write.accountId];
  const accounts = ids.map((id) => recipient.accounts.find((item) => item.accountId === id));
  if (accounts.some((item) => item === undefined)) throw notFound(profile);
  return { recipient, accounts: accounts as RecipientAccount[] };
}

/** Binds the confirmation to the profile, the write and the current live state it changes. */
function confirmation(profile: string, write: RecipientWrite, recipient: Recipient, accounts: RecipientAccount[]): string {
  const state = [recipient.name, recipient.accounts.length, accounts.map((item) => [item.accountId, item.accountNumber, item.bankCode, item.alias, item.favorite])];
  return createHash('sha256').update(JSON.stringify([profile, write, state])).digest('hex').slice(0, 16);
}

const describeAccount = (account: RecipientAccount) => ({
  accountId: account.accountId, bank: account.bank, accountType: account.accountType, accountNumber: mask(account.accountNumber), alias: account.alias, favorite: account.favorite,
});

function preview(write: RecipientWrite, recipient: Recipient, accounts: RecipientAccount[]) {
  const base = { action: write.action, recipient: { id: recipient.id, name: recipient.name, accounts: recipient.accounts.length } };
  if (write.action === 'edit') {
    return {
      ...base, effect: 'write' as const, authorization: 'Mi Pass may be requested',
      change: {
        ...(write.name === undefined ? {} : { name: { from: recipient.name, to: write.name } }),
        aliases: write.aliases.map((item, index) => ({ ...describeAccount(accounts[index] as RecipientAccount), alias: { from: (accounts[index] as RecipientAccount).alias, to: item.alias } })),
      },
    };
  }
  const account = accounts[0] as RecipientAccount;
  return {
    ...base, account: describeAccount(account),
    change: write.action === 'favorite' ? { favorite: { from: account.favorite, to: write.favorite } } : { deleted: true },
    effect: write.action === 'favorite' ? 'write' as const : 'destructive' as const,
  };
}

/** Portal text sometimes stores accents as HTML entities (e.g. `Ping&uuml;ino`). */
export function decodeEntities(value: string): string {
  const named: Record<string, string> = { aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', amp: '&' };
  return value.replace(/&(#\d+|[a-zA-Z]+);/gu, (entity, code: string) => (code.startsWith('#') ? String.fromCodePoint(Number(code.slice(1))) : named[code] ?? entity));
}

/** Prepare performs no write: it checks the target live and returns the preview and its confirmation. */
export async function prepareRecipientWrite(input: { profile: string; write: RecipientWrite }, portal: RecipientWritePortal) {
  requireSafeProfile(input.profile);
  const { recipient, accounts } = locate(await portal.listRecipients(), input.write, input.profile);
  const code = confirmation(input.profile, input.write, recipient, accounts);
  const write = input.write;
  const args = write.action === 'edit'
    ? `edit --recipient-id ${recipient.id}${write.name === undefined ? '' : ' --name <name>'}${write.aliases.map((item) => ` --alias ${item.accountId}=<alias>`).join('')}`
    : `${write.action} --recipient-id ${recipient.id} --account-id ${write.accountId}${write.action === 'favorite' ? ` --favorite ${String(write.favorite)}` : ''}`;
  return {
    preview: preview(write, recipient, accounts), confirmation: code,
    nextCommand: `portales bancochile-personas destinatarios ${args} --profile ${input.profile} --confirm ${code}`,
  };
}

/** Executes one prepared write once, then re-reads the agenda; success only when the live state shows it. */
export async function executeRecipientWrite(input: { profile: string; write: RecipientWrite; confirm: string; progress?: EditProgress }, portal: RecipientWritePortal) {
  requireSafeProfile(input.profile);
  const write = input.write;
  const { recipient, accounts } = locate(await portal.listRecipients(), write, input.profile);
  if (confirmation(input.profile, write, recipient, accounts) !== input.confirm) {
    throw new PortalError('CONFIRMATION_REQUIRED', 'The confirmation does not match this change or the agenda changed since prepare. Prepare again.', {
      recovery: { nextCommand: `portales bancochile-personas destinatarios prepare --profile ${input.profile} --action ${write.action} --recipient-id ${recipient.id} ...` },
    });
  }
  const account = accounts[0] as RecipientAccount;
  const target = (item: RecipientAccount) => ({ accountNumber: item.accountNumber, bank: item.bank });
  let miPass = false;
  if (write.action === 'favorite') {
    if (account.favorite === write.favorite) return { outcome: 'unchanged' as const, recipient };
    await portal.toggleFavorite(target(account));
  } else if (write.action === 'delete-account') {
    await portal.deleteAccount(target(account));
  } else {
    const changes = write.aliases.filter((item, index) => (accounts[index] as RecipientAccount).alias !== item.alias);
    const name = write.name !== undefined && write.name !== recipient.name ? write.name : undefined;
    if (name === undefined && changes.length === 0) return { outcome: 'unchanged' as const, recipient };
    const edit: RecipientEdit = {
      anchor: target(recipient.accounts[0] as RecipientAccount),
      ...(name === undefined ? {} : { name }),
      aliases: changes.map((item) => ({ ...target(accounts[write.aliases.indexOf(item)] as RecipientAccount), alias: item.alias })),
    };
    miPass = (await portal.editRecipient(edit, input.progress ?? (() => undefined))).miPass;
  }
  const after = (await portal.listRecipients()).find((item) => item.id === recipient.id);
  const live = (id: string) => after?.accounts.find((item) => item.accountId === id);
  let done: boolean;
  if (write.action === 'favorite') done = live(account.accountId)?.favorite === write.favorite;
  else if (write.action === 'delete-account') {
    done = live(account.accountId) === undefined
      && recipient.accounts.filter((item) => item.accountId !== account.accountId).every((item) => live(item.accountId) !== undefined);
  } else {
    done = (write.name === undefined || (after !== undefined && decodeEntities(after.name) === write.name))
      && write.aliases.every((item) => live(item.accountId)?.alias === item.alias);
  }
  if (!done) {
    throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'The portal answered, but the agenda does not show the expected result. Inspect destinatarios show before anything else.', {
      recovery: { stage: 'verify', remoteMutationPossible: true, nextCommand: `portales bancochile-personas destinatarios show --profile ${input.profile} --id ${recipient.id}` },
    });
  }
  const outcome = write.action === 'delete-account' ? 'deleted' as const : 'updated' as const;
  return { outcome, ...(write.action === 'edit' ? { miPass } : {}), recipient: after ?? null };
}
