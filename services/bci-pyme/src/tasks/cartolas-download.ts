import type { FileDescriptor } from '../../../../packages/runtime/src/downloads.js';
import { PortalError } from '../errors.js';
import { requireExactDiscoveredOption } from '../portal/selection.js';
import type { BciPymePortal, CartolaSelection } from '../portal/types.js';

export interface DownloadCartolasInput {
  profile: string;
  selections: CartolaSelection[];
}

/** Downloads validated cartolas from an existing session after rediscovering every selected ID. */
export async function downloadCartolas(
  input: DownloadCartolasInput,
  portal: BciPymePortal,
): Promise<{ downloads: Array<FileDescriptor & { businessId: string; accountId: string }> }> {
  if (input.profile.trim() === '' || input.selections.length === 0) {
    throw new PortalError('INVALID_INPUT', 'profile and at least one selection are required.');
  }
  await portal.requireAuthenticatedSession();
  const businesses = await portal.discoverBusinesses();
  const downloads = [];
  for (const selection of input.selections) {
    requireExactDiscoveredOption(businesses, selection.businessId);
    requireExactDiscoveredOption(
      await portal.discoverAccounts(selection.businessId),
      selection.accountId,
    );
    const descriptor = await portal.downloadCartola(selection);
    downloads.push({ ...descriptor, businessId: selection.businessId, accountId: selection.accountId });
  }
  return { downloads };
}

export const cartolasDownloadMetadata = {
  service: 'bci-pyme',
  operation: 'cartolas.download',
  effect: 'read',
  auth: 'session',
} as const;
