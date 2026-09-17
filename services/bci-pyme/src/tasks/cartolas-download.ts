import { basename } from 'node:path';
import type { FileDescriptor } from '../../../../packages/runtime/src/downloads.js';
import { publishArtifactFile, resolveDestination } from '../../../../packages/runtime/src/destinations.js';
import { PortalError, invalidInput } from '../errors.js';
import { requireSafeProfile } from '../auth/login-breaker.js';
import { requireExactDiscoveredOption } from '../portal/selection.js';
import type { BciPymePortal, CartolaSelection } from '../portal/types.js';
import { CatalogCache } from './catalog-cache.js';
import { discoverTree } from './cartolas-prepare.js';
import { readSnapshot, snapshotDiff, type CartolaSnapshot } from './snapshots.js';

export interface DownloadCartolasInput {
  profile: string;
  selections?: CartolaSelection[];
  snapshotId?: string;
  /** Already-loaded snapshot (read before any session is opened). Wins over snapshotId. */
  snapshot?: CartolaSnapshot;
  output?: string;
  destination?: string;
}

export interface DownloadedCartola extends FileDescriptor {
  businessId: string;
  accountId: string;
  documentType: 'excel-detallado';
  destinationSource: 'output' | 'destination' | 'default';
  validationChecks: string[];
}

interface DownloadRoots { stateRoot: string; dataRoot: string; configRoot?: string }

/** Downloads validated cartolas from an existing session, honouring a prepare snapshot when given, and publishes each file to its private destination. */
export async function downloadCartolas(
  input: DownloadCartolasInput,
  portal: BciPymePortal,
  roots?: DownloadRoots,
  now = new Date(),
): Promise<{ downloads: DownloadedCartola[]; snapshotId: string | null }> {
  requireSafeProfile(input.profile);
  let selections = input.selections ?? [];
  let snapshot: CartolaSnapshot | null = input.snapshot ?? null;
  if (snapshot === null && input.snapshotId !== undefined) {
    if (roots === undefined) throw new PortalError('INTERNAL', 'Snapshot downloads need private state roots.');
    snapshot = await readSnapshot(input.snapshotId, input.profile, roots.stateRoot, now);
  }
  if (snapshot !== null) {
    if (snapshot.profile !== input.profile) throw new PortalError('INVALID_INPUT', 'The snapshot belongs to another profile.');
    if (selections.length > 0) throw invalidInput('Use either --snapshot or explicit selections, not both.', [{ field: '--snapshot', expected: 'absent when selections are given' }]);
    selections = snapshot.selections;
  }
  if (selections.length === 0) throw invalidInput('At least one selection is required.', [{ field: 'selections', expected: 'one or more {businessId, accountId, documentType}' }]);
  await portal.requireAuthenticatedSession();
  const cache = new CatalogCache(portal, now);
  if (snapshot !== null) {
    const live = await discoverTree(cache, snapshot.selections.map((selection) => selection.businessId));
    const diff = snapshotDiff(snapshot, live);
    if (diff.changed) {
      throw new PortalError('SNAPSHOT_STALE', `Portal options changed since snapshot ${snapshot.snapshotId}: ${JSON.stringify({ businessesAppeared: diff.businessesAppeared, businessesDisappeared: diff.businessesDisappeared, accountsAppeared: diff.accountsAppeared, accountsDisappeared: diff.accountsDisappeared })}.`, {
        recovery: { stage: 'session-check', nextCommand: `portales bci-pyme cartolas prepare --profile ${input.profile} ...` },
      });
    }
  }
  const businesses = await cache.businesses();
  const downloads: DownloadedCartola[] = [];
  for (const selection of selections) {
    requireExactDiscoveredOption(businesses, selection.businessId);
    requireExactDiscoveredOption(await cache.accounts(selection.businessId), selection.accountId);
    const descriptor = await portal.downloadCartola(selection);
    let path = descriptor.path;
    let destinationSource: DownloadedCartola['destinationSource'] = 'default';
    if (roots !== undefined) {
      const destination = await resolveDestination({
        service: 'bci-pyme', profile: input.profile, documentType: selection.documentType,
        identifiers: { businessId: selection.businessId, accountId: selection.accountId },
        ...(input.output === undefined ? {} : { output: input.output }),
        ...(input.destination === undefined ? {} : { destination: input.destination }),
      }, { data: roots.dataRoot, ...(roots.configRoot === undefined ? {} : { config: roots.configRoot }) });
      const stamp = now.toISOString().replace(/[-:.TZ]/gu, '').slice(0, 14);
      const fileName = `cartola-${selection.documentType}-${stamp}-${basename(descriptor.path).replace(/^cartola-/u, '')}`;
      path = await publishArtifactFile(descriptor.path, destination.directory, fileName.replace(/[^A-Za-z0-9._-]/gu, '-'));
      destinationSource = destination.source;
    }
    downloads.push({
      ...descriptor, path, businessId: selection.businessId, accountId: selection.accountId, documentType: selection.documentType, destinationSource,
      validationChecks: ['private-permissions', 'signature', 'zip-crc', 'xlsx-structure', 'workbook-labels'],
    });
  }
  return { downloads, snapshotId: snapshot?.snapshotId ?? null };
}

export const cartolasDownloadMetadata = {
  service: 'bci-pyme',
  operation: 'cartolas.download',
  effect: 'read',
  auth: 'session',
} as const;
