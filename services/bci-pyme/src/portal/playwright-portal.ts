import { randomUUID } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  chromium,
  type BrowserContext,
  type BrowserType,
  type Frame,
  type Locator,
  type Page,
} from 'playwright';
import { validateDownloadedFile, type SupportedDownloadMediaType } from '../../../../packages/runtime/src/downloads.js';
import { PortalError } from '../errors.js';
import type { BusinessOption } from '../tasks/businesses-list.js';
import type { AccountOption, BciPymePortal, CartolaSelection } from './types.js';
import type { BciCredentials, LoginPortal } from '../tasks/auth-login.js';
import { requireSafeProfile } from '../auth/login-breaker.js';

export const publicLoginUrl = 'https://www.bci.cl/corporativo/banco-en-linea/pyme';
export const authenticatedShellUrl = 'https://bel.bci.cl/cl/bci/aplicaciones/contenidoLayoutOSSPyme.jsf';
export const businessSelectorUrl = 'https://bel.bci.cl/cl/bci/aplicaciones/seguridad/autenticacion/vista/vistaSelectorConvenio.jsf';
export const deviceOmitName = /^omitir(?: por ahora)?$/iu;

export function isAuthenticatedLocation(
  pageUrl: string,
  frameUrls: string[],
  movementControls: number,
): boolean {
  return /vistaSelectorConvenio\.jsf/iu.test(pageUrl)
    || frameUrls.some((url) => /fe-oss-shell-dashboard/iu.test(url))
    || movementControls === 1;
}

export function privateBciPaths(profile: string, stateRoot: string, dataRoot: string) {
  requireSafeProfile(profile);
  const base = ['portales', 'bci-pyme', profile];
  return {
    profileDirectory: join(stateRoot, ...base, 'browser'),
    downloadDirectory: join(dataRoot, ...base, 'downloads'),
  };
}

type PersistentLaunchOptions = Parameters<BrowserType['launchPersistentContext']>[1];

export function browserLaunchOptions(proxyServer: string | undefined): PersistentLaunchOptions {
  return {
    acceptDownloads: true,
    channel: 'chrome',
    headless: false,
    ...(proxyServer === undefined ? {} : { proxy: { server: proxyServer } }),
  };
}

async function requireUnique(locator: Locator, description: string): Promise<Locator> {
  if (await locator.count() !== 1) {
    throw new PortalError('PORTAL_CHANGED', `Expected exactly one ${description}.`);
  }
  return locator;
}

async function requireUniqueVisible(locator: Locator, description: string): Promise<Locator> {
  const visible: Locator[] = [];
  for (const candidate of await locator.all()) {
    if (await candidate.isVisible()) visible.push(candidate);
  }
  if (visible.length !== 1) {
    throw new PortalError('PORTAL_CHANGED', `Expected exactly one visible ${description}.`);
  }
  return visible[0] as Locator;
}

export class PlaywrightBciPymePortal implements BciPymePortal {
  private constructor(
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly downloadDirectory: string,
  ) {}

  static async open(profile: string): Promise<PlaywrightBciPymePortal> {
    const stateRoot = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
    const dataRoot = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
    const paths = privateBciPaths(profile, stateRoot, dataRoot);
    await mkdir(paths.profileDirectory, { recursive: true, mode: 0o700 });
    await mkdir(paths.downloadDirectory, { recursive: true, mode: 0o700 });
    await chmod(paths.profileDirectory, 0o700);
    await chmod(paths.downloadDirectory, 0o700);
    const context = await chromium.launchPersistentContext(paths.profileDirectory, {
      ...browserLaunchOptions(process.env.PORTALES_BROWSER_PROXY),
      downloadsPath: paths.downloadDirectory,
    });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(businessSelectorUrl, { waitUntil: 'domcontentloaded' });
    return new PlaywrightBciPymePortal(context, page, paths.downloadDirectory);
  }

  async close(): Promise<void> {
    await this.context.close();
  }

  async requireAuthenticatedSession(): Promise<void> {
    const stopLabels = ['CAPTCHA', 'MFA', 'Turnstile', 'Cuenta bloqueada', 'Acceso bloqueado'];
    for (const label of stopLabels) {
      if (await this.page.getByText(label, { exact: true }).count() > 0) {
        const code = label.includes('bloquead') ? 'ACCOUNT_BLOCKED' : 'ADDITIONAL_AUTH_REQUIRED';
        throw new PortalError(code, `The portal displayed a stop condition: ${label}.`);
      }
    }
    let movementControls = 0;
    for (const frame of this.page.frames()) {
      movementControls += await frame.getByRole('link', { name: 'Mis Movimientos', exact: true })
        .or(frame.getByRole('button', { name: 'Mis Movimientos', exact: true })).count();
    }
    if (isAuthenticatedLocation(
      this.page.url(),
      this.page.frames().map((frame) => frame.url()),
      movementControls,
    )) return;
    if (await this.page.getByRole('button', { name: 'Ingresar', exact: true }).count() > 0) {
      throw new PortalError('SESSION_EXPIRED', 'The BCI session is not authenticated. Run auth login explicitly.');
    }
    throw new PortalError('PORTAL_CHANGED', 'The authenticated BCI shell was not uniquely identifiable.');
  }

  private async businessRows(): Promise<Locator> {
    const rows = this.page.locator('tr').filter({
      has: this.page.locator("a[id*='linkConvenio']"),
    });
    if (await rows.count() === 0) {
      throw new PortalError('PORTAL_CHANGED', 'No business rows were available.');
    }
    return rows;
  }

  async discoverBusinesses(): Promise<BusinessOption[]> {
    const values = await (await this.businessRows()).evaluateAll((rows) => rows.map((row) => {
      const link = row.querySelector("a[id*='linkConvenio']");
      const cells = row.querySelectorAll('td');
      return {
        id: link === null ? '' : link.textContent.trim(),
        label: cells.item(cells.length - 1).textContent.trim(),
      };
    }));
    if (values.some(({ id, label }) => id === '' || label === '')
      || new Set(values.map(({ id }) => id)).size !== values.length) {
      throw new PortalError('PORTAL_CHANGED', 'Business rows were incomplete or duplicated.');
    }
    return values;
  }

  private async waitForFrame(urlFragment: string, timeoutMs = 60_000): Promise<Frame> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const frame = this.page.frames().find((candidate) => candidate.url().includes(urlFragment));
      if (frame !== undefined) return frame;
      await this.page.waitForTimeout(250);
    }
    throw new PortalError('PORTAL_CHANGED', `BCI did not load the expected ${urlFragment} application.`);
  }

  private async openMovements(businessId: string): Promise<{ movements: Frame; business: BusinessOption }> {
    await this.page.goto(businessSelectorUrl, { waitUntil: 'domcontentloaded' });
    const businesses = await this.discoverBusinesses();
    const index = businesses.findIndex(({ id }) => id === businessId);
    if (index < 0) throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'The selected business ID was not discovered.');
    const business = businesses[index] as BusinessOption;
    const links = this.page.locator("a[id*='linkConvenio']");
    if (await links.count() !== businesses.length) throw new PortalError('PORTAL_CHANGED', 'Business controls changed before selection.');
    await links.nth(index).click();
    const dashboard = await this.waitForFrame('fe-oss-shell-dashboard');
    const movementLink = dashboard.getByText('Mis Movimientos', { exact: false }).first();
    await movementLink.waitFor({ state: 'visible', timeout: 30_000 });
    await movementLink.click();
    const movements = await this.waitForFrame('fe-oss-shell-mov-cuenta');
    await movements.waitForTimeout(8_000);
    return { movements, business };
  }

  private async currentAccounts(movements: Frame): Promise<AccountOption[]> {
    const labels = await movements.locator('fe-oss-widget-accounts-cartola h1').allTextContents();
    const accounts = labels.map((label) => ({
      id: label.replace(/\D/gu, ''),
      label: label.trim(),
    })).filter(({ id, label }) => /^\d{7,20}$/u.test(id) && label !== '');
    if (accounts.length === 0 || new Set(accounts.map(({ id }) => id)).size !== accounts.length) {
      throw new PortalError('PORTAL_CHANGED', 'The current account could not be identified uniquely.');
    }
    return accounts;
  }

  async discoverAccounts(businessId: string): Promise<AccountOption[]> {
    const { movements } = await this.openMovements(businessId);
    return this.currentAccounts(movements);
  }

  async downloadCartola(selection: CartolaSelection) {
    const { movements, business } = await this.openMovements(selection.businessId);
    const accounts = await this.currentAccounts(movements);
    if (accounts.length !== 1 || accounts[0]?.id !== selection.accountId) {
      throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'The selected account is not the current discovered account.');
    }
    const accountWidget = await requireUnique(
      movements.locator('fe-oss-widget-accounts-cartola').filter({ hasText: selection.accountId }),
      'selected account widget',
    );
    const downloadButton = await requireUniqueVisible(
      accountWidget.getByRole('button', { name: /Descargar/iu }),
      'selected account download button',
    );
    await downloadButton.click();
    const optionName = /Descargar excel detallado/iu;
    const option = await requireUnique(movements.getByText(optionName), 'download option');
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: 120_000 }),
      option.click(),
    ]);
    if (await download.failure() !== null) throw new PortalError('PORTAL_CHANGED', 'BCI did not complete the download.');
    const path = join(this.downloadDirectory, `cartola-${randomUUID()}.xlsx`);
    await download.saveAs(path);
    const mediaType: SupportedDownloadMediaType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return validateDownloadedFile(path, mediaType, business.label);
  }
}

async function detectedStop(page: Page): Promise<PortalError | undefined> {
  if (/un momento|just a moment/iu.test(await page.title()) || /elige-metodo/iu.test(page.url())) {
    return new PortalError('ADDITIONAL_AUTH_REQUIRED', 'The login was stopped by an additional verification stage.');
  }
  const patterns: Array<[RegExp, 'ADDITIONAL_AUTH_REQUIRED' | 'ACCOUNT_BLOCKED' | 'RATE_LIMITED']> = [
    [/captcha|turnstile|c[oó]digo.*(seguridad|verificaci[oó]n)|segundo factor/iu, 'ADDITIONAL_AUTH_REQUIRED'],
    [/cuenta.*bloquead|acceso.*bloquead/iu, 'ACCOUNT_BLOCKED'],
    [/demasiados intentos|intenta m[aá]s tarde/iu, 'RATE_LIMITED'],
  ];
  for (const frame of page.frames()) {
    for (const [pattern, code] of patterns) {
      if (await frame.getByText(pattern).count() > 0) {
        return new PortalError(code, 'The login was stopped by a protected portal state.');
      }
    }
  }
  return undefined;
}

async function hasAuthenticatedShell(page: Page): Promise<boolean> {
  let controls = 0;
  for (const frame of page.frames()) {
    controls += await frame.getByRole('link', { name: 'Mis Movimientos', exact: true })
      .or(frame.getByRole('button', { name: 'Mis Movimientos', exact: true })).count();
  }
  return isAuthenticatedLocation(
    page.url(),
    page.frames().map((frame) => frame.url()),
    controls,
  );
}

/** Owns the complete observed login interaction; callers cannot select enrollment or retry it. */
export class PlaywrightBciLoginPortal implements LoginPortal {
  constructor(private readonly profile: string) {}

  async authenticate(
    credentials: BciCredentials,
    submitted: () => void,
    accepted: () => void,
  ): Promise<void> {
    const stateRoot = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
    const dataRoot = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
    const paths = privateBciPaths(this.profile, stateRoot, dataRoot);
    await mkdir(paths.profileDirectory, { recursive: true, mode: 0o700 });
    await chmod(paths.profileDirectory, 0o700);
    const context = await chromium.launchPersistentContext(paths.profileDirectory, browserLaunchOptions(process.env.PORTALES_BROWSER_PROXY));
    try {
      const page = context.pages()[0] ?? await context.newPage();
      await page.goto(publicLoginUrl, { waitUntil: 'domcontentloaded' });
      const before = await detectedStop(page);
      if (before !== undefined) throw before;

      const rut = await requireUnique(page.locator('#rut_aux'), 'RUT field');
      await rut.click();
      await rut.pressSequentially(credentials.rut);
      const password = await requireUnique(page.locator("input[type='password']"), 'password field');
      await password.click();
      await password.pressSequentially(credentials.password);
      const enter = await requireUnique(page.getByRole('button', { name: /^ingresar$/iu }), 'INGRESAR button');
      await enter.click({ trial: true });
      await enter.evaluate((node: HTMLElement) => { node.click(); });
      submitted();

      const deadline = Date.now() + 60_000;
      let omittedDeviceRegistration = false;
      while (Date.now() < deadline) {
        const pages = context.pages();
        for (const candidate of pages) {
          const stop = await detectedStop(candidate);
          if (stop !== undefined) throw stop;
          if (await hasAuthenticatedShell(candidate)) {
            accepted();
            return;
          }
        }

        if (!omittedDeviceRegistration) {
          const omitControls: Locator[] = [];
          for (const candidate of pages) {
            const omit = candidate.getByRole('button', { name: deviceOmitName });
            const count = await omit.count();
            for (let index = 0; index < count; index += 1) omitControls.push(omit.nth(index));
          }
          if (omitControls.length > 1) {
            throw new PortalError('PORTAL_CHANGED', 'The optional device-registration stage was ambiguous.');
          }
          if (omitControls.length === 1) {
            accepted();
            await omitControls[0]?.click();
            omittedDeviceRegistration = true;
          }
        }
        await page.waitForTimeout(250);
      }
      throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'The login result could not be verified safely.');
    } finally {
      await context.close();
    }
  }
}
