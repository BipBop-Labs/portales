import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, errors } from 'playwright';
import { classifyPage, type Classification, type PageDescription } from '../../../../packages/runtime/src/page-state.js';
import { PortalError } from '../errors.js';
import { asPortalError } from '../../../../packages/runtime/src/errors.js';
import { bciContract, describeBciPage } from './page-state.js';
import { browserLaunchOptions, dismissOptionalBciCookies, publicLoginUrl } from './playwright-portal.js';

export interface PublicLoginObservation {
  states: Array<{ expectedState: string; description: PageDescription; classification: Classification; ariaSnapshot: string }>;
  stoppedBefore: 'fill';
  navigationTimedOut: boolean;
  documentReadyState: string;
  optionalCookiesRejected: boolean;
}

/** Public structure only: fresh profile, no keyring, no saved session, no typing or submission. */
export async function observePublicBciLogin(): Promise<PublicLoginObservation> {
  const directory = await mkdtemp(join(tmpdir(), 'portales-bci-public-'));
  let phase = 'browser-launch';
  try {
    const context = await chromium.launchPersistentContext(directory, browserLaunchOptions(process.env.PORTALES_BROWSER_PROXY));
    try {
      const page = context.pages()[0] ?? await context.newPage();
      let navigationTimedOut = false;
      try {
        phase = 'public-navigation';
        await page.goto(publicLoginUrl, { waitUntil: 'domcontentloaded' });
      } catch (error: unknown) {
        if (!(error instanceof errors.TimeoutError)) throw error;
        // A timeout does not imply an empty page. Capture only the public structure; never retry navigation.
        navigationTimedOut = true;
      }
      phase = 'public-contract';
      const loaded = await bciContract('auth.login');
      const state = loaded?.contract.pageStates['login-page'];
      if (loaded === null || state === undefined) throw new PortalError('INTERNAL', 'Missing public login contract.');
      phase = 'public-description';
      const description = await describeBciPage(page, state);
      phase = 'optional-cookie-choice';
      const optionalCookiesRejected = await dismissOptionalBciCookies(page);
      phase = 'public-aria';
      const ariaSnapshot = await page.locator('body').ariaSnapshot({ timeout: 10_000 }).catch(() => '');
      phase = 'public-readiness';
      const documentReadyState = await page.evaluate(() => document.readyState);
      return {
        states: [{ expectedState: 'login-page', description,
          classification: classifyPage(loaded.contract, description, { candidates: ['login-page'] }),
          ariaSnapshot,
        }],
        stoppedBefore: 'fill', navigationTimedOut,
        documentReadyState,
        optionalCookiesRejected,
      };
    } finally { await context.close(); }
  } catch (error: unknown) {
    throw asPortalError(error).withRecovery({ nextAction: `Public login observation failed during ${phase}. No credentials were read, typed or submitted; inspect the browser/provider boundary.` });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
