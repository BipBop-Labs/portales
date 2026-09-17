import { PortalError, invalidInput } from '../errors.js';
import { requireSafeProfile } from '../auth/login-breaker.js';
import type { CartolaSelection } from '../portal/types.js';
import { CatalogCache, OPTION_SOURCE, type CatalogPortal } from './catalog-cache.js';
import { SNAPSHOT_TTL_MS, newSnapshotId, snapshotFingerprint, writeSnapshot, type CartolaSnapshot, type SnapshotBusiness } from './snapshots.js';

export const CARTOLAS_CONTRACT_VERSION = '2026-09-17';

export interface PrepareCartolasInput {
  profile: string;
  /** Label, alias, or exact ID pairs; resolution must be unique. */
  requests: { business: string; account: string; documentType?: string }[];
}

interface DiscoveredOption { id: string; label: string }

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/gu, '').replace(/\s+/gu, ' ').trim().toLowerCase();
}

/** Exact ID first; otherwise a unique case/accent-insensitive label match. Anything else fails with the candidate list. */
export function resolveUnique<T extends DiscoveredOption>(options: readonly T[], requested: string, field: string, discoverWith: string): T {
  const byId = options.filter((option) => option.id === requested);
  if (byId.length === 1) return byId[0] as T;
  const wanted = normalize(requested);
  const byLabel = options.filter((option) => normalize(option.label) === wanted);
  if (byLabel.length === 1) return byLabel[0] as T;
  const partial = byLabel.length === 0 ? options.filter((option) => normalize(option.label).includes(wanted)) : byLabel;
  if (partial.length === 1) return partial[0] as T;
  const candidates = partial.length > 0 ? partial : options;
  throw invalidInput(
    partial.length > 1
      ? `${field} "${requested}" matches ${String(partial.length)} options; use an exact ID.`
      : `${field} "${requested}" did not match any discovered option.`,
    [{ field, expected: `one exact ID or unique label among: ${candidates.map((option) => option.id).join(', ')}`, received: requested, discoverWith }],
    { nextCommand: discoverWith },
  );
}

export async function discoverTree(cache: CatalogCache, businessIds?: readonly string[]): Promise<SnapshotBusiness[]> {
  const businesses = await cache.businesses();
  const wanted = businessIds === undefined ? businesses : businesses.filter((business) => businessIds.includes(business.id));
  const tree: SnapshotBusiness[] = [];
  for (const business of wanted) {
    tree.push({ id: business.id, label: business.label, accounts: await cache.accounts(business.id) });
  }
  return tree;
}

/** Resolves labels once against one live session, validates dependencies, and stores a short-lived snapshot for the final command. */
export async function prepareCartolas(input: PrepareCartolasInput, portal: CatalogPortal, stateRoot: string, now = new Date()) {
  requireSafeProfile(input.profile);
  if (input.requests.length === 0) throw invalidInput('At least one business/account request is required.', [{ field: '--business', expected: 'business label or ID', discoverWith: `portales bci-pyme businesses options --profile ${input.profile} --tree` }]);
  await portal.requireAuthenticatedSession();
  const cache = new CatalogCache(portal, now);
  const businesses = await cache.businesses();
  const selections: CartolaSelection[] = [];
  const discoverBusinesses = `portales bci-pyme businesses list --profile ${input.profile}`;
  for (const request of input.requests) {
    const business = resolveUnique(businesses, request.business, '--business', discoverBusinesses);
    const account = resolveUnique(await cache.accounts(business.id), request.account, '--account', `portales bci-pyme accounts options --profile ${input.profile} --business-id ${business.id}`);
    if (request.documentType !== undefined && request.documentType !== 'excel-detallado') {
      throw invalidInput('Unsupported document type.', [{ field: 'documentType', expected: 'excel-detallado', discoverWith: 'portales bci-pyme cartolas options' }]);
    }
    const selection: CartolaSelection = { businessId: business.id, accountId: account.id, documentType: 'excel-detallado' };
    if (!selections.some((item) => item.businessId === selection.businessId && item.accountId === selection.accountId)) selections.push(selection);
  }
  const discovered = await discoverTree(cache, selections.map((selection) => selection.businessId));
  const snapshot: CartolaSnapshot = {
    schemaVersion: '1', snapshotId: newSnapshotId(now), service: 'bci-pyme', profile: input.profile, operation: 'cartolas.prepare',
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + SNAPSHOT_TTL_MS).toISOString(), contractVersion: CARTOLAS_CONTRACT_VERSION,
    selections, fingerprint: snapshotFingerprint(selections, discovered), discovered,
  };
  await writeSnapshot(snapshot, stateRoot);
  return {
    snapshotId: snapshot.snapshotId, expiresAt: snapshot.expiresAt, fingerprint: snapshot.fingerprint, contractVersion: snapshot.contractVersion,
    selections, resolved: selections.map((selection) => {
      const business = discovered.find((item) => item.id === selection.businessId);
      return { businessId: selection.businessId, businessLabel: business?.label ?? '', accountId: selection.accountId, accountLabel: business?.accounts.find((account) => account.id === selection.accountId)?.label ?? '', documentType: selection.documentType };
    }),
    observedAt: cache.observedAt, source: OPTION_SOURCE,
    nextCommand: `portales bci-pyme cartolas download --profile ${input.profile} --snapshot ${snapshot.snapshotId}`,
  };
}

export function requireSnapshotProfile(snapshot: CartolaSnapshot, profile: string): void {
  if (snapshot.profile !== profile) throw new PortalError('INVALID_INPUT', 'The snapshot belongs to another profile.');
}

export const cartolasPrepareMetadata = { service: 'bci-pyme', operation: 'cartolas.prepare', effect: 'read', auth: 'session' } as const;
