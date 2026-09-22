import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requireSafeProfile } from '../auth/login-breaker.js';
import { PortalError } from '../errors.js';
import { isValidRut } from '../rut.js';
import { requireExactDiscoveredOption } from '../portal/selection.js';
import { recipientBankMatches } from '../portal/recipient-bank.js';
import type { BciPymePortal, Recipient, RecipientProgress } from '../portal/types.js';

const selection = {
  businessId: z.string().trim().min(1),
  bankId: z.string().trim().min(1),
  rut: z.string().trim().max(12).refine(isValidRut),
  accountNumber: z.string().regex(/^\d{1,18}$/u),
};
const createSchema = z.object({
  ...selection,
  name: z.string().trim().min(1).max(40),
  alias: z.string().trim().min(1).max(25),
  email: z.union([z.literal(''), z.email().max(50)]).default(''),
  favorite: z.boolean().default(false),
}).strict();
const authorizeSchema = z.object(selection).strict();
type Action = 'create' | 'authorize' | 'delete';
type Selection = z.infer<typeof authorizeSchema>;

function matchingRecipient(recipients: Recipient[], target: Selection, bank: string) {
  const rut = (value: string) => value.replace(/[.-]/gu, '').toUpperCase();
  const matches = recipients.filter(recipient => rut(recipient.rut) === rut(target.rut)
    && recipientBankMatches(recipient.bank, bank)
    && recipient.accountNumber.replace(/^0+/u, '') === target.accountNumber.replace(/^0+/u, ''));
  if (matches.length > 1) throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'Multiple recipients match. Inspect destinatarios list; no write was submitted.');
  return matches[0];
}

// BCI saves names in title case (observed 2026-09-22), so compare names case-insensitively.
const sameName = (saved: string, requested: string) => saved.toLocaleUpperCase('es-CL') === requested.toLocaleUpperCase('es-CL');

/** Preview and execution share validation, discovery, duplicate checks and confirmation. */
export async function writeDestinatario(
  input: { profile: string; action: Action; value: unknown; preview: boolean; confirmation?: string },
  portal: BciPymePortal,
  progress: RecipientProgress = () => undefined,
) {
  requireSafeProfile(input.profile);
  const parsed = (input.action === 'create' ? createSchema : authorizeSchema).safeParse(input.value);
  if (!parsed.success) throw new PortalError('INVALID_INPUT', 'Invalid recipient input. Use the documented private JSON schema; secrets and unknown fields are not accepted.');
  const target = parsed.data;
  await portal.requireAuthenticatedSession();
  const business = requireExactDiscoveredOption(await portal.discoverBusinesses(), target.businessId);
  const banks = await portal.discoverRecipientBanks(target.businessId);
  const bank = requireExactDiscoveredOption(banks, target.bankId);
  const current = matchingRecipient(await portal.listRecipients(target.businessId), target, bank.label);
  if (input.action !== 'create' && !current) {
    throw new PortalError('INVALID_INPUT', 'The recipient was not found. Select an existing recipient from destinatarios list.');
  }
  if (input.action === 'create' && current) {
    const creation = createSchema.parse(target);
    if (!sameName(current.name, creation.name) || current.alias !== creation.alias || current.email !== creation.email) {
      throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'This RUT, bank and account already exist with different details. Inspect destinatarios list; no duplicate was created.');
    }
  }
  const willWrite = input.action === 'create' ? !current : input.action === 'delete' ? Boolean(current) : current?.status === 'pending';
  const confirmation = createHash('sha256').update(JSON.stringify({
    profile: input.profile, action: input.action, target, bank: bank.label, current: current ?? null,
  })).digest('hex');
  const preview = { action: input.action, business, bank, recipient: current ?? target, willWrite, confirmation };
  if (input.preview) {
    if (input.action === 'create' && willWrite) await portal.prepareRecipientCreation(createSchema.parse(target));
    return preview;
  }
  if (input.confirmation !== confirmation) {
    throw new PortalError('CONFIRMATION_REQUIRED', 'Run destinatarios prepare and pass its confirmation with --confirm. A changed input or recipient state requires a fresh preview.');
  }
  if (!willWrite) return { action: input.action, businessId: target.businessId, outcome: 'already-exists', recipient: current, changed: false };
  // There is deliberately no retry path, including after an uncertain result.
  if (input.action === 'create') await portal.createRecipient(createSchema.parse(target), progress);
  else if (input.action === 'delete') await portal.deleteRecipient(target.businessId, current as Recipient);
  else await portal.authorizeRecipient(target.businessId, current as Recipient, progress);
  const verified = matchingRecipient(await portal.listRecipients(target.businessId), target, bank.label);
  if (input.action === 'delete') {
    if (verified) throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'The recipient still appears after deletion. Inspect destinatarios list; do not submit again.');
    return { action: input.action, businessId: target.businessId, outcome: 'deleted', recipient: current, changed: true };
  }
  if (!verified || (input.action === 'authorize' && verified.status !== 'authorized')) {
    throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'The requested final recipient state was not verified. Run destinatarios list before any further authorization or creation.');
  }
  if (input.action === 'create') {
    const creation = createSchema.parse(target);
    if (!sameName(verified.name, creation.name) || verified.alias !== creation.alias || verified.email !== creation.email) {
      throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'Saved recipient details did not match. Inspect destinatarios list; do not submit again.');
    }
  }
  return { action: input.action, businessId: target.businessId, outcome: verified.status, recipient: verified, changed: true };
}

export const destinatariosWriteMetadata = {
  service: 'bci-pyme', operations: ['destinatarios.create', 'destinatarios.authorize'], effect: 'write', auth: 'session',
} as const;

export const destinatariosDeleteMetadata = {
  service: 'bci-pyme', operation: 'destinatarios.delete', effect: 'destructive', auth: 'session',
} as const;
