import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export interface VersionInfo {
  packageVersion: string;
  commit: string | null;
  builtAt: string | null;
  builtCommit: string | null;
  sourceCheckout: string;
  distPath: string;
  /** True when the executable no longer matches the checked-out source (commit or newer source files). */
  stale: boolean;
  staleReasons: string[];
  node: string;
}

/** The repository root, derived from this module's location in either `src` or `dist`. */
export function repositoryRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // .../packages/runtime/src or .../dist/packages/runtime/src
  const root = join(here, '..', '..', '..');
  return here.includes(join('dist', 'packages')) ? join(root, '..') : root;
}

async function newestSourceMtime(root: string): Promise<number> {
  let newest = 0;
  const walk = async (directory: string): Promise<void> => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'test' || entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(?:ts|mjs|json)$/u.test(entry.name)) {
        const info = await stat(path);
        newest = Math.max(newest, info.mtimeMs);
      }
    }
  };
  for (const workspace of ['apps', 'packages', 'services']) await walk(join(root, workspace));
  return newest;
}

export async function readVersionInfo(root = repositoryRoot()): Promise<VersionInfo> {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version?: string };
  interface BuildInfo { version?: string; commit?: string | null; builtAt?: string }
  let build: BuildInfo | null = null;
  try { build = JSON.parse(await readFile(join(root, 'dist', 'build-info.json'), 'utf8')) as BuildInfo; } catch { build = null; }
  let commit: string | null = null;
  try {
    const { stdout } = await promisify(execFile)('git', ['-C', root, 'rev-parse', 'HEAD'], { timeout: 5_000 });
    commit = stdout.trim();
  } catch { commit = null; }
  const staleReasons: string[] = [];
  if (build === null) staleReasons.push('no-build-info');
  else {
    if (commit !== null && build.commit !== null && build.commit !== undefined && build.commit !== commit) staleReasons.push('commit-differs-from-build');
    if (build.builtAt !== undefined && await newestSourceMtime(root) > Date.parse(build.builtAt)) staleReasons.push('source-newer-than-build');
  }
  return {
    packageVersion: pkg.version ?? '0.0.0',
    commit,
    builtAt: build?.builtAt ?? null,
    builtCommit: build?.commit ?? null,
    sourceCheckout: root,
    distPath: join(root, 'dist'),
    stale: staleReasons.length > 0,
    staleReasons,
    node: process.version,
  };
}
