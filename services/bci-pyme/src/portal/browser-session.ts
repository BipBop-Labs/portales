import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type BrowserType } from 'playwright';
import { z } from 'zod';
import { PortalError } from '../errors.js';
import { restoreSessionCookies } from './session-cookies.js';

const isBciDomain = (domain: string) => domain === 'bci.cl' || domain.endsWith('.bci.cl');
const savedState = z.object({
  cookies: z.array(z.object({
    name: z.string(), value: z.string(), domain: z.string().refine(isBciDomain), path: z.string(),
    expires: z.number(), httpOnly: z.boolean(), secure: z.boolean(),
    sameSite: z.enum(['Strict', 'Lax', 'None']), partitionKey: z.string().optional(),
  })),
  origins: z.array(z.object({
    origin: z.string().regex(/^https:\/\/(?:[a-z0-9-]+\.)*bci\.cl$/u),
    localStorage: z.array(z.object({ name: z.string(), value: z.string() })),
  })),
});

/** Keep bank session state, never Chrome's persistent download history or UI state. */
export async function saveBrowserSession(context: Pick<BrowserContext, 'storageState'>, directory: string): Promise<void> {
  const state = await context.storageState();
  const filtered = savedState.parse({
    cookies: state.cookies.filter(cookie => isBciDomain(cookie.domain)),
    origins: state.origins.filter(origin => isBciDomain(new URL(origin.origin).hostname)),
  });
  const path = join(directory, 'session-state.json');
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

/** Each command gets a clean headed profile, restoring only the same BCI session. */
export async function openBrowserSession(
  directory: string,
  options: Parameters<BrowserType['launchPersistentContext']>[1],
): Promise<BrowserContext> {
  const path = join(directory, 'session-state.json');
  let encoded: string | undefined;
  try {
    encoded = await readFile(path, 'utf8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Migrate the existing local profile once, without navigation or authentication.
    const hasLegacyProfile = await stat(join(directory, 'Default', 'Cookies')).then(() => true, (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    });
    if (hasLegacyProfile) {
      const legacy = await chromium.launchPersistentContext(directory, options);
      try {
        await restoreSessionCookies(legacy, directory);
        await saveBrowserSession(legacy, directory);
      } finally {
        await legacy.close();
      }
      encoded = await readFile(path, 'utf8');
    }
  }
  let state: z.infer<typeof savedState> | undefined;
  if (encoded !== undefined) {
    try { state = savedState.parse(JSON.parse(encoded) as unknown); } catch {
      throw new PortalError('SESSION_EXPIRED', 'Saved BCI browser session is invalid. Run auth login explicitly.');
    }
  }
  const temporary = await mkdtemp(join(tmpdir(), 'portales-bci-browser-'));
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
