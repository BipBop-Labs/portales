import { requireSafeProfile } from '../auth/login-breaker.js';
import { requireExactDiscoveredOption } from '../portal/selection.js';
import type { BciPymePortal } from '../portal/types.js';

/** Reads authorized and pending recipients within one explicitly selected business. */
export async function listDestinatarios(
  input: { profile: string; businessId: string },
  portal: Pick<BciPymePortal, 'requireAuthenticatedSession' | 'discoverBusinesses' | 'listRecipients'>,
) {
  requireSafeProfile(input.profile);
  await portal.requireAuthenticatedSession();
  requireExactDiscoveredOption(await portal.discoverBusinesses(), input.businessId);
  return { businessId: input.businessId, recipients: await portal.listRecipients(input.businessId) };
}

export const destinatariosListMetadata = {
  service: 'bci-pyme', operation: 'destinatarios.list', effect: 'read', auth: 'session',
} as const;
