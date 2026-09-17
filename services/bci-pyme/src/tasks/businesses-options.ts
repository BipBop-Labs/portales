import { requireSafeProfile } from '../auth/login-breaker.js';
import { CARTOLAS_CONTRACT_VERSION, discoverTree } from './cartolas-prepare.js';
import { CatalogCache, OPTION_SOURCE, type CatalogPortal } from './catalog-cache.js';

/** Businesses, optionally with nested accounts, discovered in one session. */
export async function listBusinessOptions(input: { profile: string; tree: boolean }, portal: CatalogPortal, now = new Date()) {
  requireSafeProfile(input.profile);
  await portal.requireAuthenticatedSession();
  const cache = new CatalogCache(portal, now);
  const common = { observedAt: cache.observedAt, source: OPTION_SOURCE, contractVersion: CARTOLAS_CONTRACT_VERSION, freshness: 'discovered-this-run' as const };
  if (!input.tree) {
    const businesses = await cache.businesses();
    return { field: 'business-id' as const, dependsOn: {}, options: businesses.map(({ id, label }) => ({ id, label, aliases: [] as string[] })), ...common };
  }
  const tree = await discoverTree(cache);
  return {
    field: 'business-id' as const, dependsOn: {}, ...common,
    options: tree.map((business) => ({
      id: business.id, label: business.label, aliases: [] as string[],
      accounts: { field: 'account-id' as const, dependsOn: { businessId: business.id }, options: business.accounts.map(({ id, label }) => ({ id, label, aliases: [] as string[] })) },
    })),
  };
}

export const businessesOptionsMetadata = { service: 'bci-pyme', operation: 'businesses.options', effect: 'read', auth: 'session' } as const;
