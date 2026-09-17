import type { BusinessOption } from './businesses-list.js';
import type { AccountOption, BciPymePortal } from '../portal/types.js';

export type CatalogPortal = Pick<BciPymePortal, 'requireAuthenticatedSession' | 'discoverBusinesses' | 'discoverAccounts'>;

export interface CachedCatalog {
  observedAt: string;
  businesses: BusinessOption[];
  accountsByBusiness: Map<string, AccountOption[]>;
}

/** Run-scoped memoization: one session discovers each catalog at most once. Nothing persists across runs. */
export class CatalogCache {
  private readonly catalog: CachedCatalog;
  private businessesPromise: Promise<BusinessOption[]> | undefined;
  private readonly accountPromises = new Map<string, Promise<AccountOption[]>>();

  constructor(private readonly portal: CatalogPortal, now = new Date()) {
    this.catalog = { observedAt: now.toISOString(), businesses: [], accountsByBusiness: new Map() };
  }

  get observedAt(): string {
    return this.catalog.observedAt;
  }

  businesses(): Promise<BusinessOption[]> {
    this.businessesPromise ??= this.portal.discoverBusinesses().then((items) => {
      this.catalog.businesses = items;
      return items;
    });
    return this.businessesPromise;
  }

  accounts(businessId: string): Promise<AccountOption[]> {
    let pending = this.accountPromises.get(businessId);
    if (pending === undefined) {
      pending = this.portal.discoverAccounts(businessId).then((items) => {
        this.catalog.accountsByBusiness.set(businessId, items);
        return items;
      });
      this.accountPromises.set(businessId, pending);
    }
    return pending;
  }
}

export const OPTION_SOURCE = 'live' as const;
