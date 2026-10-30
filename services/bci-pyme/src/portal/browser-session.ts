import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type BrowserContext } from 'playwright';
import {
  openBrowserSession as openSharedBrowserSession,
  saveBrowserSession as saveSharedBrowserSession,
  sessionStateFile,
  type LaunchOptions,
  type SessionScope,
} from '../../../../packages/runtime/src/browser-session.js';
import { restoreSessionCookies } from './session-cookies.js';

const bciScope: SessionScope = { label: 'bci', domain: 'bci.cl' };

/** Keep bank session state, never Chrome's persistent download history or UI state. */
export function saveBrowserSession(context: Pick<BrowserContext, 'storageState'>, directory: string): Promise<void> {
  return saveSharedBrowserSession(context, directory, bciScope);
}

/** Each command gets a clean headed profile, restoring only the same BCI session. */
export async function openBrowserSession(directory: string, options: LaunchOptions): Promise<BrowserContext> {
  const present = await readFile(join(directory, sessionStateFile), 'utf8').then(() => true, (error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  });
  if (!present) {
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
    }
  }
  return openSharedBrowserSession(directory, options, bciScope);
}
