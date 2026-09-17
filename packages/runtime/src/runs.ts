import { randomBytes } from 'node:crypto';
import { mkdir, open, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserMode } from './browser-mode.js';
import type { PortalErrorCode, RecoveryMetadata, ValidationDetail } from './errors.js';
import type { StageTiming } from './events.js';
import { isSafeName, stateRoot } from './paths.js';

const RUN_RETENTION = 200;

export function newRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/gu, '').slice(0, 14);
  return `run_${stamp}_${randomBytes(4).toString('hex')}`;
}

export function isRunId(value: string): boolean {
  return /^run_\d{14}_[0-9a-f]{8}$/u.test(value);
}

/** Bounded artifact descriptor kept in a run record (no document contents). */
export interface RunArtifactRef {
  artifactId: string;
  mediaType: string;
  byteCount: number;
  sha256: string;
  path: string;
}

/** Private, bounded record of one run. Never credentials, cookies, HTML, bodies, or account data. */
export interface RunRecord {
  schemaVersion: '1';
  runId: string;
  service: string;
  operation: string;
  profile: string | null;
  effect: 'read' | 'write' | 'destructive';
  startedAt: string;
  endedAt: string | null;
  status: 'running' | 'completed' | 'failed';
  exitCode: number | null;
  browserMode: BrowserMode;
  contractVersion: string | null;
  packageVersion: string;
  commit: string | null;
  stages: StageTiming[];
  error: {
    code: PortalErrorCode;
    recovery: RecoveryMetadata;
    validation?: ValidationDetail[];
  } | null;
  artifacts: RunArtifactRef[];
}

export function runsDirectory(root = stateRoot()): string {
  return join(root, 'portales', 'runs');
}

export async function writeRunRecord(record: RunRecord, root = stateRoot()): Promise<string> {
  const directory = runsDirectory(root);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${record.runId}.json`);
  const file = await open(path, 'w', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
    await file.chmod(0o600);
  } finally {
    await file.close();
  }
  return path;
}

export async function readRunRecord(runId: string, root = stateRoot()): Promise<RunRecord | null> {
  if (!isRunId(runId)) return null;
  try {
    return JSON.parse(await readFile(join(runsDirectory(root), `${runId}.json`), 'utf8')) as RunRecord;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function listRunRecords(
  filter: { service?: string; profile?: string; limit?: number } = {},
  root = stateRoot(),
): Promise<RunRecord[]> {
  let names: string[];
  try {
    names = await readdir(runsDirectory(root));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const records: RunRecord[] = [];
  for (const name of names.filter((item) => item.endsWith('.json')).sort().reverse()) {
    const record = await readRunRecord(name.replace(/\.json$/u, ''), root);
    if (record === null) continue;
    if (filter.service !== undefined && record.service !== filter.service) continue;
    if (filter.profile !== undefined && record.profile !== filter.profile) continue;
    records.push(record);
    if (records.length >= (filter.limit ?? 50)) break;
  }
  return records;
}

/** Keeps the newest records only, so the private directory stays bounded. */
export async function pruneRunRecords(root = stateRoot(), keep = RUN_RETENTION): Promise<void> {
  let names: string[];
  try {
    names = (await readdir(runsDirectory(root))).filter((item) => item.endsWith('.json')).sort();
  } catch {
    return;
  }
  for (const name of names.slice(0, Math.max(0, names.length - keep))) {
    await rm(join(runsDirectory(root), name), { force: true });
  }
}

export interface ServiceLock {
  runId: string;
  pid: number;
  service: string;
  profile: string;
  operation: string;
  acquiredAt: string;
}

function locksDirectory(root: string, service: string): string {
  return join(root, 'portales', 'locks', service);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Serializes browser-backed runs per service/profile. Returns the active lock when held elsewhere. */
export async function acquireServiceLock(
  lock: Omit<ServiceLock, 'acquiredAt' | 'pid'>,
  root = stateRoot(),
): Promise<{ acquired: true; release: () => Promise<void> } | { acquired: false; active: ServiceLock }> {
  if (!isSafeName(lock.service) || !isSafeName(lock.profile)) {
    throw new Error('Lock names must be safe local names.');
  }
  const directory = locksDirectory(root, lock.service);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${lock.profile}.json`);
  const record: ServiceLock = { ...lock, pid: process.pid, acquiredAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, 'wx', 0o600);
      try {
        await file.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
      } finally {
        await file.close();
      }
      return { acquired: true, release: () => rm(path, { force: true }) };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let active: ServiceLock | undefined;
      try {
        active = JSON.parse(await readFile(path, 'utf8')) as ServiceLock;
      } catch {
        active = undefined;
      }
      if (active !== undefined && isProcessAlive(active.pid)) return { acquired: false, active };
      // Stale lock from a dead process: remove it once and retry the exclusive create.
      await rm(path, { force: true });
    }
  }
  throw new Error('The service lock could not be acquired.');
}

export async function readServiceLock(service: string, profile: string, root = stateRoot()): Promise<ServiceLock | null> {
  try {
    const active = JSON.parse(await readFile(join(locksDirectory(root, service), `${profile}.json`), 'utf8')) as ServiceLock;
    return isProcessAlive(active.pid) ? active : null;
  } catch {
    return null;
  }
}

export async function runRecordExists(runId: string, root = stateRoot()): Promise<boolean> {
  try {
    await stat(join(runsDirectory(root), `${runId}.json`));
    return true;
  } catch {
    return false;
  }
}
