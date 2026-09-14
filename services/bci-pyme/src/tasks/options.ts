import { PortalError } from '../errors.js';
import type { BciPymePortal } from '../portal/types.js';
import { requireExactDiscoveredOption } from '../portal/selection.js';

interface AccountOptionsInput {
  profile: string;
  businessId: string;
}

/** Discovers every account ID currently valid for one exact discovered business ID. */
export async function listAccountOptions(
  input: AccountOptionsInput,
  portal: Pick<BciPymePortal, 'requireAuthenticatedSession' | 'discoverBusinesses' | 'discoverAccounts'>,
) {
  if (input.profile.trim() === '' || input.businessId.trim() === '') {
    throw new PortalError('INVALID_INPUT', 'profile and business-id must not be empty.');
  }
  await portal.requireAuthenticatedSession();
  requireExactDiscoveredOption(await portal.discoverBusinesses(), input.businessId);
  const accounts = await portal.discoverAccounts(input.businessId);
  return {
    field: 'account-id' as const,
    dependsOn: { businessId: input.businessId },
    options: accounts.map(({ id, label }) => ({ id, label, aliases: [] as string[] })),
  };
}

/** Lists the complete documented cartola document-type catalog. */
export function listCartolaOptions() {
  return {
    field: 'document-type' as const,
    dependsOn: {},
    options: [
      { id: 'excel-detallado', label: 'Excel detallado', aliases: [] as string[] },
    ],
  };
}
