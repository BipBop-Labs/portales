import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type BrowserType } from 'playwright';
import { z } from 'zod';
import { PortalError } from './errors.js';

export type LaunchOptions = Parameters<BrowserType['launchPersistentContext']>[1];

/** The registrable domain whose cookies and origin storage form one service's session. */
export interface SessionScope {
  /** Short service label used in temporary profile names and error text. */
  label: string;
  /** e.g. `bci.cl`: matches the domain itself and every subdomain. */
  domain: string;
}

const inScope = (scope: SessionScope, host: string) => {
  const bare = host.replace(/^\./u, '');
  return bare === scope.domain || bare.endsWith(`.${scope.domain}`);
};

function stateSchema(scope: SessionScope) {
  return z.object({
    cookies: z.array(z.object({
      name: z.string(), value: z.string(), domain: z.string().refine(domain => inScope(scope, domain)), path: z.string(),
      expires: z.number(), httpOnly: z.boolean(), secure: z.boolean(),
      sameSite: z.enum(['Strict', 'Lax', 'None']), partitionKey: z.string().optional(),
    })),
    origins: z.array(z.object({
      origin: z.string().refine(origin => origin.startsWith('https://') && inScope(scope, new URL(origin).hostname)),
      localStorage: z.array(z.object({ name: z.string(), value: z.string() })),
    })),
  });
}

export const sessionStateFile = 'session-state.json';

/** Keep only the service's cookies and origin storage, never Chrome's persistent history or UI state. */
export async function saveBrowserSession(context: Pick<BrowserContext, 'storageState'>, directory: string, scope: SessionScope): Promise<void> {
  const state = await context.storageState();
  const filtered = stateSchema(scope).parse({
    cookies: state.cookies.filter(cookie => inScope(scope, cookie.domain)),
    origins: state.origins.filter(origin => inScope(scope, new URL(origin.origin).hostname)),
  });
  const path = join(directory, sessionStateFile);
  const temporary = `${path}.${randomUUID()}`;
  try {
    await writeFile(temporary, JSON.stringify(filtered), { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}

/** Each command gets a clean temporary profile restoring only the saved session of the same service. */
export async function openBrowserSession(directory: string, options: LaunchOptions, scope: SessionScope): Promise<BrowserContext> {
  let encoded: string | undefined;
  try {
    encoded = await readFile(join(directory, sessionStateFile), 'utf8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let state: z.infer<ReturnType<typeof stateSchema>> | undefined;
  if (encoded !== undefined) {
    try { state = stateSchema(scope).parse(JSON.parse(encoded) as unknown); } catch {
      throw new PortalError('SESSION_EXPIRED', `Saved ${scope.label} browser session is invalid. Run auth login explicitly.`);
    }
  }
  const temporary = await mkdtemp(join(tmpdir(), `portales-${scope.label}-browser-`));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(temporary, options);
    context.once('close', () => { void rm(temporary, { recursive: true, force: true }).catch(() => undefined); });
    if (state !== undefined) {
      await context.setStorageState({
        origins: state.origins,
        cookies: state.cookies.map(({ partitionKey, ...cookie }) => ({
          ...cookie, ...(partitionKey === undefined ? {} : { partitionKey }),
        })),
      });
    }
    return context;
  } catch (error: unknown) {
    await context?.close();
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

/** Headed Chrome stable: what the bank portals were observed with. */
export function headedChromeOptions(proxyServer: string | undefined): LaunchOptions {
  return {
    acceptDownloads: true,
    channel: 'chrome',
    headless: false,
    ...(proxyServer === undefined ? {} : { proxy: { server: proxyServer } }),
  };
}
