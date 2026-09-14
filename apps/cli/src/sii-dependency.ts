import { spawn as spawnChild } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ChildHandle {
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

type Spawn = (
  command: string,
  args: string[],
  options: { stdio: 'inherit' },
) => ChildHandle;

interface SiiDependencyOptions {
  entrypoint?: string;
  spawn?: Spawn;
}

function installedEntrypoint(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../../../services/sii/packages/cli/dist/main.js'),
    resolve(here, '../../../services/sii/packages/cli/dist/main.js'),
  ];
  const entrypoint = candidates.find((candidate) => existsSync(candidate));
  if (!entrypoint) {
    throw new Error('SII dependency is not built. Run `npm run setup:sii`.');
  }
  return entrypoint;
}

export function runSiiDependency(
  args: string[],
  options: SiiDependencyOptions = {},
): Promise<number> {
  const entrypoint = options.entrypoint ?? installedEntrypoint();
  const spawn: Spawn = options.spawn ?? ((command, childArgs, childOptions) =>
    spawnChild(command, childArgs, childOptions));

  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [entrypoint, ...args], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      resolveExit(code ?? (signal ? 1 : 0));
    });
  });
}
