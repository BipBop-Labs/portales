import { requireSafeProfile } from '../auth/login-breaker.js';
import type { BciPymePortal } from '../portal/types.js';
import { requireExactDiscoveredOption } from '../portal/selection.js';

/** Discovers the complete bank catalog in the selected business's recipient form. */
export async function listDestinatarioOptions(
  input: { profile: string; businessId: string },
  portal: Pick<BciPymePortal, 'requireAuthenticatedSession' | 'discoverBusinesses' | 'discoverRecipientBanks'>,
) {
  requireSafeProfile(input.profile);
  await portal.requireAuthenticatedSession();
  requireExactDiscoveredOption(await portal.discoverBusinesses(), input.businessId);
  const banks = await portal.discoverRecipientBanks(input.businessId);
  return {
    field: 'bank-id' as const,
    dependsOn: { businessId: input.businessId },
    options: banks.map(bank => ({ ...bank, aliases: [] as string[] })),
  };
}

export const destinatariosOptionsMetadata = {
  service: 'bci-pyme', operation: 'destinatarios.options', effect: 'read', auth: 'session',
} as const;
