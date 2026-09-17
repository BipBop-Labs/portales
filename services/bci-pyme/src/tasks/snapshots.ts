import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PortalError } from '../errors.js';
import { requireSafeProfile } from '../auth/login-breaker.js';
import type { CartolaSelection } from '../portal/types.js';

export const SNAPSHOT_TTL_MS = 15 * 60 * 1000;

export interface SnapshotBusiness { id: string; label: string; accounts: { id: string; label: string }[] }

/** Discovery snapshot: normalized intent plus the option tree it was validated against. Never cookies or document data. */
export interface CartolaSnapshot {
  schemaVersion: '1';
  snapshotId: string;
  service: 'bci-pyme';
  profile: string;
  operation: 'cartolas.prepare';
  createdAt: string;
  expiresAt: string;
  contractVersion: string;
  selections: CartolaSelection[];
  fingerprint: string;
  discovered: SnapshotBusiness[];
}

export function newSnapshotId(now = new Date()): string {
  return `snap_${now.toISOString().replace(/[-:.TZ]/gu, '').slice(0, 14)}_${randomBytes(4).toString('hex')}`;
}

export function isSnapshotId(value: string): boolean {
  return /^snap_\d{14}_[0-9a-f]{8}$/u.test(value);
}

export function snapshotFingerprint(selections: CartolaSelection[], discovered: SnapshotBusiness[]): string {
  const ids = discovered.map((business) => `${business.id}:${business.accounts.map((account) => account.id).sort().join(',')}`).sort();
  return createHash('sha256').update(JSON.stringify({ selections, ids })).digest('hex');
}

function directory(stateRoot: string, profile: string): string {
  requireSafeProfile(profile);
  return join(stateRoot, 'portales', 'bci-pyme', 'snapshots', profile);
}

export async function writeSnapshot(snapshot: CartolaSnapshot, stateRoot: string): Promise<void> {
  const dir = directory(stateRoot, snapshot.profile);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = await open(join(dir, `${snapshot.snapshotId}.json`), 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(snapshot)}\n`, 'utf8');
    await file.chmod(0o600);
  } finally {
    await file.close();
  }
}

/** Loads a snapshot for this exact profile and rejects one that has expired. Staleness is checked against live discovery by the caller. */
export async function readSnapshot(snapshotId: string, profile: string, stateRoot: string, now = new Date()): Promise<CartolaSnapshot> {
  const invalid = () => new PortalError('INVALID_INPUT', 'Unknown snapshot for this profile. Run cartolas prepare again.', {
    validation: [{ field: '--snapshot', expected: 'a snapshotId returned by cartolas prepare for this profile', received: snapshotId }],
    recovery: { nextCommand: `portales bci-pyme cartolas prepare --profile ${profile} ...` },
  });
  if (!isSnapshotId(snapshotId)) throw invalid();
  let snapshot: CartolaSnapshot;
  try {
    snapshot = JSON.parse(await readFile(join(directory(stateRoot, profile), `${snapshotId}.json`), 'utf8')) as CartolaSnapshot;
  } catch {
    throw invalid();
  }
  if (snapshot.profile !== profile || snapshot.snapshotId !== snapshotId) throw invalid();
  if (Date.parse(snapshot.expiresAt) <= now.getTime()) {
    throw new PortalError('SNAPSHOT_EXPIRED', `Snapshot ${snapshotId} expired at ${snapshot.expiresAt}.`, {
      recovery: { nextCommand: `portales bci-pyme cartolas prepare --profile ${profile} ...` },
    });
  }
  return snapshot;
}

/** Smallest structural diff between the snapshot's option tree and live discovery, restricted to the selected businesses. */
export function snapshotDiff(snapshot: CartolaSnapshot, live: SnapshotBusiness[]) {
  const liveBusinesses = new Set(live.map((business) => business.id));
  const snapBusinesses = new Set(snapshot.discovered.map((business) => business.id));
  const businessesAppeared = [...liveBusinesses].filter((id) => !snapBusinesses.has(id));
  const businessesDisappeared = [...snapBusinesses].filter((id) => !liveBusinesses.has(id));
  const accountsAppeared: { businessId: string; accountId: string }[] = [];
  const accountsDisappeared: { businessId: string; accountId: string }[] = [];
  const selected = new Set(snapshot.selections.map((selection) => selection.businessId));
  for (const business of snapshot.discovered) {
    if (!selected.has(business.id)) continue;
    const liveAccounts = new Set((live.find((item) => item.id === business.id)?.accounts ?? []).map((account) => account.id));
    const snapAccounts = new Set(business.accounts.map((account) => account.id));
    for (const id of liveAccounts) if (!snapAccounts.has(id)) accountsAppeared.push({ businessId: business.id, accountId: id });
    for (const id of snapAccounts) if (!liveAccounts.has(id)) accountsDisappeared.push({ businessId: business.id, accountId: id });
  }
  const changed = businessesAppeared.length + businessesDisappeared.length + accountsAppeared.length + accountsDisappeared.length > 0;
  return { changed, businessesAppeared, businessesDisappeared, accountsAppeared, accountsDisappeared };
}
