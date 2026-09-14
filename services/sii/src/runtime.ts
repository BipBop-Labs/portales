import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  FileAuditSink,
  FileKeyValueStore,
  createNodeRuntime,
} from './node.js';
import type { Runtime } from './seams/index.js';

function safeProfile(profile: string): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(profile)) throw new Error('Invalid SII profile.');
  return profile;
}

export function siiDocumentsDir(profile: string): string {
  const dataRoot = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  return join(dataRoot, 'portales', 'sii', safeProfile(profile), 'documents');
}

export function createPortalesSiiRuntime(
  profile: string,
  overrides: Partial<Runtime> = {},
): Runtime {
  const safe = safeProfile(profile);
  const dataRoot = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  const stateRoot = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
  return createNodeRuntime({
    store: new FileKeyValueStore(join(dataRoot, 'portales', 'sii', safe)),
    audit: new FileAuditSink(join(stateRoot, 'portales', 'sii', safe, 'audit.jsonl')),
    ...overrides,
  });
}
