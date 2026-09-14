export interface BusinessOption {
  id: string;
  label: string;
}

export interface BusinessesPortal {
  requireAuthenticatedSession(): Promise<void>;
  discoverBusinesses(): Promise<BusinessOption[]>;
}

export interface ListBusinessesInput {
  profile: string;
}

/** Lists every business currently exposed by an already-authenticated BCI Pyme session. */
export async function listBusinesses(
  input: ListBusinessesInput,
  portal: BusinessesPortal,
): Promise<{ businesses: BusinessOption[] }> {
  if (input.profile.trim().length === 0) {
    throw new Error('profile must not be empty');
  }
  await portal.requireAuthenticatedSession();
  return { businesses: await portal.discoverBusinesses() };
}

export const businessesListMetadata = {
  service: 'bci-pyme',
  operation: 'businesses.list',
  effect: 'read',
  auth: 'session',
} as const;
