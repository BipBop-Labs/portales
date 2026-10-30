import { chmod, mkdir } from 'node:fs/promises';
import type { BrowserContext, Page } from 'playwright';
import { headedChromeOptions, openBrowserSession, saveBrowserSession } from '../../../../packages/runtime/src/browser-session.js';
import { PortalError } from '../../../../packages/runtime/src/errors.js';
import { dataRoot, stateRoot } from '../../../../packages/runtime/src/paths.js';
import { privatePaths, sessionScope } from '../auth/state.js';

export const appUrl = 'https://portalpersonas.bancochile.cl/mibancochile-web/front/persona/index.html';
const portalHost = 'portalpersonas.bancochile.cl';

/** An authenticated personas-portal page restored from the saved session. Never logs in. */
export class PortalSession {
  private closed = false;

  private constructor(private readonly context: BrowserContext, readonly page: Page, private readonly profileDirectory: string) {
    context.on('close', () => { this.closed = true; });
  }

  static async open(profile: string): Promise<PortalSession> {
    const paths = privatePaths(profile, stateRoot(), dataRoot());
    await mkdir(paths.profileDirectory, { recursive: true, mode: 0o700 });
    await chmod(paths.profileDirectory, 0o700);
    const context = await openBrowserSession(paths.profileDirectory, headedChromeOptions(process.env.PORTALES_BROWSER_PROXY), sessionScope);
    try {
      const page = context.pages()[0] ?? await context.newPage();
      const session = new PortalSession(context, page, paths.profileDirectory);
      await session.requireAuthenticated();
      return session;
    } catch (error: unknown) {
      await context.close();
      throw error;
    }
  }

  /** Loads the home route; an unauthenticated session is redirected to the Auth0 login host. */
  private async requireAuthenticated(): Promise<void> {
    await this.page.goto(`${appUrl}#/home`, { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const host = new URL(this.page.url()).host;
      if (host !== portalHost) {
        throw new PortalError('SESSION_EXPIRED', 'The Banco de Chile session is not authenticated. Run auth login explicitly.', {
          recovery: { stage: 'session-check', nextCommand: 'portales bancochile-personas auth login --profile <profile>' },
        });
      }
      if (await this.page.locator('button.megamenu__l1-button').filter({ visible: true }).count() > 0) {
        await this.dismissPromotion();
        return;
      }
      await this.page.waitForTimeout(500);
    }
    throw new PortalError('READINESS_TIMEOUT', 'The authenticated personas portal did not become ready.', { recovery: { stage: 'session-check' } });
  }

  /** The home may open one promotional dialog over the menu (observed 2026-10-30); close only that dialog. */
  private async dismissPromotion(): Promise<void> {
    await this.page.waitForTimeout(2_000);
    const close = this.page.locator('mat-dialog-container .bch-modal i.ion-ios-close-empty').filter({ visible: true });
    if (await close.count() !== 1) return;
    await close.click();
    await this.page.locator('mat-dialog-container').waitFor({ state: 'hidden', timeout: 10_000 });
  }

  async close(): Promise<void> {
    try {
      if (!this.closed) await saveBrowserSession(this.context, this.profileDirectory, sessionScope);
    } finally {
      await this.context.close();
    }
  }
}
