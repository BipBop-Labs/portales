import { homedir } from 'node:os';
import { join } from 'node:path';

/** Private roots for state (run records, locks, breakers) and data (sessions, artifacts). */
export function stateRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
}

export function dataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
}

export function configRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
}

const safeName = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u;

export function isSafeName(value: string): boolean {
  return safeName.test(value);
}
