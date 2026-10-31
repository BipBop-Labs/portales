import { PortalError, invalidInput } from '../../../../packages/runtime/src/errors.js';
import { requireSafeProfile } from '../../../../packages/runtime/src/login-breaker.js';
import { isValidRut, sameRut } from '../../../../packages/runtime/src/rut.js';
import type { Recipient } from '../portal/recipients.js';

export interface RecipientsPortal { listRecipients(): Promise<Recipient[]> }

/** Every recipient in the transfer agenda, with all their accounts. Values are private. */
export async function listDestinatarios(input: { profile: string }, portal: RecipientsPortal) {
  requireSafeProfile(input.profile);
  const recipients = await portal.listRecipients();
  return { total: recipients.length, accounts: recipients.reduce((total, item) => total + item.accounts.length, 0), recipients };
}

export type RecipientQuery = { id: string } | { rut: string } | { name: string };

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es-CL');

/** Recipients whose name contains every word of the query, ignoring case and accents. */
export function matchesName(name: string, query: string): boolean {
  const words = fold(query).split(/\s+/u).filter(Boolean);
  const target = fold(name);
  return words.length > 0 && words.every((word) => target.includes(word));
}

/** One recipient and all their accounts, by exact ID, RUT in any form, or name words.
 *  Several name matches return the candidates instead of guessing. */
export async function showDestinatario(input: { profile: string; query: RecipientQuery }, portal: RecipientsPortal) {
  requireSafeProfile(input.profile);
  const { query } = input;
  if ('rut' in query && !isValidRut(query.rut)) {
    throw invalidInput('The RUT is not valid.', [{ field: '--rut', expected: 'a valid RUT, dots and dash optional' }]);
  }
  const recipients = await portal.listRecipients();
  const matches = recipients.filter((item) => ('id' in query ? item.id === query.id
    : 'rut' in query ? sameRut(item.rut, query.rut) : matchesName(item.name, query.name)));
  const list = `portales bancochile-personas destinatarios list --profile ${input.profile}`;
  if (matches.length === 0) {
    throw new PortalError('INVALID_INPUT', 'No recipient matches.', { recovery: { nextCommand: list } });
  }
  if (matches.length > 1) {
    throw invalidInput(`${String(matches.length)} recipients match; repeat with --id.`, matches.map((item) => ({
      field: '--id', expected: item.id, received: item.name,
    })), { nextCommand: `portales bancochile-personas destinatarios show --profile ${input.profile} --id <id>` });
  }
  return matches[0] as Recipient;
}
