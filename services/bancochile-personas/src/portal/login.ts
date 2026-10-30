import { chmod, mkdir } from 'node:fs/promises';
import type { Page } from 'playwright';
import { headedChromeOptions, openBrowserSession, saveBrowserSession } from '../../../../packages/runtime/src/browser-session.js';
import { PortalError } from '../../../../packages/runtime/src/errors.js';
import { requireUnique } from '../../../../packages/runtime/src/locators.js';
import { rutDigits, sameRut } from '../../../../packages/runtime/src/rut.js';
import type { OneShotLoginPortal } from '../../../../packages/runtime/src/one-shot-login.js';
import { sanitizeRoute } from '../../../../packages/runtime/src/observation.js';
import { dataRoot, stateRoot } from '../../../../packages/runtime/src/paths.js';
import { privatePaths, sessionScope } from '../auth/state.js';
import type { Credentials } from '../tasks/auth.js';

/** Unauthenticated, this redirects to the Auth0 login at login.portales.bancochile.cl (observed 2026-10-30). */
export const portalUrl = 'https://portalpersonas.bancochile.cl/persona/';
const loginHost = 'login.portales.bancochile.cl';
const portalHost = 'portalpersonas.bancochile.cl';

const route = (url: string) => { try { return `${new URL(url).host}${sanitizeRoute(url)}`; } catch { return '<unparsed>'; } };

/** Stop states are read only from headings, alerts and dialogs: the login page itself shows
 *  security tips that mention codes and keys, so whole-page text would misfire. */
async function detectedStop(page: Page): Promise<PortalError | undefined> {
  if (/un momento|just a moment|attention required/iu.test(await page.title())) {
    return new PortalError('ADDITIONAL_AUTH_REQUIRED', 'The login was stopped by an anti-bot verification page.');
  }
  const patterns: Array<[RegExp, 'ADDITIONAL_AUTH_REQUIRED' | 'ACCOUNT_BLOCKED' | 'RATE_LIMITED']> = [
    [/captcha|no eres un robot|mi pass|clave din[aá]mica|c[oó]digo de (seguridad|verificaci[oó]n)|segundo factor|verifica tu identidad/iu, 'ADDITIONAL_AUTH_REQUIRED'],
    [/bloquead/iu, 'ACCOUNT_BLOCKED'],
    [/demasiados intentos|intenta m[aá]s tarde/iu, 'RATE_LIMITED'],
  ];
  for (const frame of page.frames()) {
    const prominent = frame.locator('h1, h2, h3, [role="alert"], [role="dialog"], [aria-live]').filter({ visible: true });
    const texts = await prominent.allInnerTexts().catch(() => [] as string[]);
    for (const [pattern, code] of patterns) {
      if (texts.some((text) => pattern.test(text))) return new PortalError(code, 'The login was stopped by a protected portal state.');
    }
  }
  return undefined;
}

/** Authenticated: back on the personas portal, no login form, no Auth0 error parameter. */
async function onAuthenticatedPortal(page: Page): Promise<boolean> {
  let url: URL;
  try { url = new URL(page.url()); } catch { return false; }
  if (url.host !== portalHost || url.searchParams.has('error')) return false;
  return await page.locator("input[type='password']").filter({ visible: true }).count() === 0;
}

/** Owns the complete observed login interaction; callers cannot retry it. */
export class PlaywrightLoginPortal implements OneShotLoginPortal<Credentials> {
  constructor(private readonly profile: string) {}

  async authenticate(credentials: Credentials, submitted: () => void, accepted: () => void): Promise<void> {
    const paths = privatePaths(this.profile, stateRoot(), dataRoot());
    await mkdir(paths.profileDirectory, { recursive: true, mode: 0o700 });
    await chmod(paths.profileDirectory, 0o700);
    const context = await openBrowserSession(paths.profileDirectory, headedChromeOptions(process.env.PORTALES_BROWSER_PROXY), sessionScope);
    const trail: string[] = [];
    let authenticationAccepted = false;
    try {
      const page = context.pages()[0] ?? await context.newPage();
      page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) trail.push(route(frame.url())); });
      await page.goto(portalUrl, { waitUntil: 'domcontentloaded' });
      if (new URL(page.url()).host !== loginHost) {
        throw new PortalError('CONTRACT_MISMATCH', `Expected the login page at ${loginHost}; observed ${trail.join(' → ')}.`, { recovery: { stage: 'navigate', loginAttempted: false } });
      }
      const before = await detectedStop(page);
      if (before !== undefined) throw before;

      const rut = await requireUnique(page.locator('#ppriv_per-login-click-input-rut'), 'RUT field');
      await rut.click();
      // The field inserts dots and dash as you type: type digits only, then verify locally before any submission.
      await rut.pressSequentially(rutDigits(credentials.rut) ?? '');
      if (!sameRut(await rut.inputValue(), credentials.rut)) {
        throw new PortalError('CONTRACT_MISMATCH', 'The RUT field did not keep the typed value; nothing was submitted.', { recovery: { stage: 'navigate', loginAttempted: false } });
      }
      const password = await requireUnique(page.locator('#ppriv_per-login-click-input-password'), 'password field');
      await password.click();
      await password.pressSequentially(credentials.password);
      const enter = await requireUnique(page.locator('#ppriv_per-login-click-ingresar-login'), 'INGRESAR button');
      await enter.click();
      submitted();

      const deadline = Date.now() + 90_000;
      let stableSince: number | undefined;
      while (Date.now() < deadline) {
        for (const candidate of context.pages()) {
          const stop = await detectedStop(candidate);
          if (stop !== undefined) throw stop;
        }
        if (await onAuthenticatedPortal(page)) {
          stableSince ??= Date.now();
          if (Date.now() - stableSince >= 3_000) {
            authenticationAccepted = true;
            accepted();
            return;
          }
        } else {
          stableSince = undefined;
        }
        await page.waitForTimeout(500);
      }
      throw new PortalError('REMOTE_STATE_AMBIGUOUS', `The login result could not be verified safely; observed ${trail.join(' → ')}.`, { recovery: { stage: 'verify', loginAttempted: true } });
    } finally {
      try {
        if (authenticationAccepted) await saveBrowserSession(context, paths.profileDirectory, sessionScope);
      } finally {
        await context.close();
      }
    }
  }
}
