import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { dataRoot } from './paths.js';

/** Complete descriptor of one verified download. Contents never appear here. */
export interface ArtifactDescriptor {
  schemaVersion: '1';
  artifactId: string;
  runId: string;
  service: string;
  profile: string;
  operation: string;
  /** Selected business/account/entity identifiers as returned by discovery commands. */
  identifiers: Record<string, string>;
  documentType: string;
  extractedAt: string;
  /** ISO dates when the covered period is verifiable from the portal or the document; otherwise null. */
  coveredPeriod: { from: string; to: string } | null;
  byteCount: number;
  mediaType: string;
  sha256: string;
  /** Static names of validation checks that passed (for example `signature`, `xlsx-structure`). */
  validationChecks: string[];
  path: string;
}

export function newArtifactId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/gu, '').slice(0, 14);
  return `art_${stamp}_${randomBytes(4).toString('hex')}`;
}

export function isArtifactId(value: string): boolean {
  return /^art_\d{14}_[0-9a-f]{8}$/u.test(value);
}

export function artifactsIndexDirectory(root = dataRoot()): string {
  return join(root, 'portales', 'artifacts', 'index');
}

export async function recordArtifact(
  input: Omit<ArtifactDescriptor, 'schemaVersion' | 'artifactId'> & { artifactId?: string },
  root = dataRoot(),
): Promise<ArtifactDescriptor> {
  const descriptor: ArtifactDescriptor = { schemaVersion: '1', artifactId: input.artifactId ?? newArtifactId(), ...input };
  const directory = artifactsIndexDirectory(root);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = await open(join(directory, `${descriptor.artifactId}.json`), 'w', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(descriptor)}\n`, 'utf8');
    await file.chmod(0o600);
  } finally {
    await file.close();
  }
  return descriptor;
}

export async function readArtifact(artifactId: string, root = dataRoot()): Promise<ArtifactDescriptor | null> {
  if (!isArtifactId(artifactId)) return null;
  try {
    return JSON.parse(await readFile(join(artifactsIndexDirectory(root), `${artifactId}.json`), 'utf8')) as ArtifactDescriptor;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function listArtifacts(
  filter: { service?: string; profile?: string; documentType?: string; identifiers?: Record<string, string>; limit?: number } = {},
  root = dataRoot(),
): Promise<ArtifactDescriptor[]> {
  let names: string[];
  try {
    names = await readdir(artifactsIndexDirectory(root));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const items: ArtifactDescriptor[] = [];
  for (const name of names.filter((item) => item.endsWith('.json')).sort().reverse()) {
    const descriptor = await readArtifact(name.replace(/\.json$/u, ''), root);
    if (descriptor === null) continue;
    if (filter.service !== undefined && descriptor.service !== filter.service) continue;
    if (filter.profile !== undefined && descriptor.profile !== filter.profile) continue;
    if (filter.documentType !== undefined && descriptor.documentType !== filter.documentType) continue;
    if (filter.identifiers !== undefined
      && Object.entries(filter.identifiers).some(([key, value]) => descriptor.identifiers[key] !== value)) continue;
    items.push(descriptor);
    if (items.length >= (filter.limit ?? 50)) break;
  }
  return items;
}

/** Re-checks an indexed artifact against the file on disk without reading it into the result. */
export async function verifyArtifact(descriptor: ArtifactDescriptor): Promise<{
  exists: boolean; byteCountMatches: boolean; sha256Matches: boolean; privatePermissions: boolean;
}> {
  try {
    const fileStat = await stat(descriptor.path);
    const bytes = await readFile(descriptor.path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return {
      exists: fileStat.isFile(),
      byteCountMatches: fileStat.size === descriptor.byteCount,
      sha256Matches: sha256 === descriptor.sha256,
      privatePermissions: (fileStat.mode & 0o077) === 0,
    };
  } catch {
    return { exists: false, byteCountMatches: false, sha256Matches: false, privatePermissions: false };
  }
}
