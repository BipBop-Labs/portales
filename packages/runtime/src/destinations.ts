import { access, copyFile, link, mkdir, readFile, realpath, stat, unlink } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { PortalError, invalidInput } from './errors.js';
import { configRoot, dataRoot, isSafeName } from './paths.js';

/** Private local destination catalog. Organization aliases live here, never in the repository. */
export interface DestinationConfig {
  version: 1;
  destinations: Record<string, { directory: string; service?: string; profile?: string }>;
}

export function destinationsConfigPath(root = configRoot()): string {
  return join(root, 'portales', 'destinations.json');
}

export async function readDestinationConfig(root = configRoot()): Promise<DestinationConfig> {
  try {
    const parsed = JSON.parse(await readFile(destinationsConfigPath(root), 'utf8')) as Partial<DestinationConfig>;
    if (parsed.version !== 1 || typeof parsed.destinations !== 'object') {
      throw new PortalError('INVALID_INPUT', `The destination configuration at ${destinationsConfigPath(root)} must be {"version":1,"destinations":{...}}.`);
    }
    return { version: 1, destinations: parsed.destinations };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, destinations: {} };
    throw error;
  }
}

async function insideRepository(directory: string): Promise<boolean> {
  for (let current = directory; ; current = dirname(current)) {
    if (await access(join(current, '.git')).then(() => true, () => false)) return true;
    if (dirname(current) === current) return false;
  }
}

/** A private (0700), existing directory outside any repository checkout. */
export async function requirePrivateDirectory(directory: string, field: string): Promise<string> {
  if (!isAbsolute(directory)) throw invalidInput(`${field} must be an absolute path.`, [{ field, expected: 'absolute path to an existing private directory' }]);
  let real: string;
  try {
    real = await realpath(directory);
    if (!(await stat(real)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw invalidInput(`${field} must be an existing directory.`, [{ field, expected: 'existing private directory outside any repository', received: directory }]);
  }
  if (((await stat(real)).mode & 0o077) !== 0) {
    throw invalidInput(`${field} must be private (mode 0700).`, [{ field, expected: 'directory without group/other permissions', received: directory }], { nextAction: `chmod 700 ${directory}` });
  }
  if (await insideRepository(real)) {
    throw invalidInput(`${field} must be outside any repository checkout.`, [{ field, expected: 'directory outside any git repository', received: directory }]);
  }
  return real;
}

export interface DestinationRequest {
  service: string;
  profile: string;
  documentType: string;
  /** Selected identifiers in dependency order (business, account, ...). Used for default isolation. */
  identifiers: Record<string, string>;
  /** Explicit private directory (`--output`). Wins over alias and default. */
  output?: string;
  /** Alias from the private destination configuration (`--destination`). */
  destination?: string;
}

export interface ResolvedDestination {
  directory: string;
  source: 'output' | 'destination' | 'default';
  alias?: string;
}

/** Chooses where a verified artifact is placed. The default isolates by service, profile, and every selected identifier. */
export async function resolveDestination(request: DestinationRequest, roots: { config?: string; data?: string } = {}): Promise<ResolvedDestination> {
  if (request.output !== undefined && request.destination !== undefined) {
    throw invalidInput('Use either --output or --destination, not both.', [{ field: '--output', expected: 'absent when --destination is given' }]);
  }
  if (request.output !== undefined) {
    return { directory: await requirePrivateDirectory(request.output, '--output'), source: 'output' };
  }
  if (request.destination !== undefined) {
    const config = await readDestinationConfig(roots.config);
    const entry = config.destinations[request.destination];
    if (entry === undefined) {
      throw invalidInput(`Unknown destination alias ${request.destination}.`, [{ field: '--destination', expected: `an alias defined in ${destinationsConfigPath(roots.config)}`, received: request.destination }], { nextAction: `Add the alias to ${destinationsConfigPath(roots.config)} (private, mode 0600).` });
    }
    if ((entry.service !== undefined && entry.service !== request.service) || (entry.profile !== undefined && entry.profile !== request.profile)) {
      throw invalidInput(`Destination ${request.destination} is restricted to another service or profile.`, [{ field: '--destination', expected: `an alias allowed for ${request.service}/${request.profile}` }]);
    }
    return { directory: await requirePrivateDirectory(entry.directory, `destinations.${request.destination}.directory`), source: 'destination', alias: request.destination };
  }
  const segments = [request.service, request.profile, request.documentType, ...Object.values(request.identifiers)];
  for (const segment of segments) {
    if (!isSafeName(segment)) throw invalidInput('Identifiers used for artifact isolation must be safe local names.', [{ field: 'identifiers', expected: 'letters, digits, dot, underscore, dash', received: segment }]);
  }
  const directory = join(roots.data ?? dataRoot(), 'portales', 'artifacts', ...segments);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return { directory, source: 'default' };
}

/** Atomically publishes a verified temporary file into its destination without overwriting. */
export async function publishArtifactFile(temporaryPath: string, directory: string, fileName: string): Promise<string> {
  if (!isSafeName(basename(fileName)) || basename(fileName) !== fileName) {
    throw new PortalError('INTERNAL', 'Artifact file names must be safe local names.');
  }
  const finalPath = resolve(directory, fileName);
  try {
    await link(temporaryPath, finalPath);
    await unlink(temporaryPath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw invalidInput(`An artifact already exists at ${finalPath}; refusing to overwrite.`, [{ field: '--output', expected: 'a destination without an existing file of the same name' }], {
        nextAction: 'Use portales artifacts list to find the existing artifact, or choose another private destination.', nextCommand: 'portales artifacts list',
      });
    }
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    // Different filesystem: copy without overwriting, then remove the staged copy.
    await copyFile(temporaryPath, finalPath, fsConstants.COPYFILE_EXCL);
    await unlink(temporaryPath);
  }
  return finalPath;
}
