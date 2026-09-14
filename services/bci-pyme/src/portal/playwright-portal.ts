import { randomUUID } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  type BrowserContext,
  type BrowserType,
  type Frame,
  type Locator,
  type Page,
} from 'playwright';
import { validateDownloadedFile, type SupportedDownloadMediaType } from '../../../../packages/runtime/src/downloads.js';
import { PortalError } from '../errors.js';
import type { BusinessOption } from '../tasks/businesses-list.js';
import type { AccountOption, BciPymePortal, CartolaSelection, Recipient, RecipientCreation, RecipientProgress } from './types.js';
import type { BciCredentials, LoginPortal } from '../tasks/auth-login.js';
import { openBrowserSession, saveBrowserSession } from './browser-session.js';
import { requireSafeProfile } from '../auth/login-breaker.js';
import { hasExactRecipientDeleteQuestion } from './recipient-delete.js';

export const publicLoginUrl = 'https://www.bci.cl/corporativo/banco-en-linea/pyme';
export const authenticatedShellUrl = 'https://bel.bci.cl/cl/bci/aplicaciones/contenidoLayoutOSSPyme.jsf';
export const businessSelectorUrl = 'https://bel.bci.cl/cl/bci/aplicaciones/seguridad/autenticacion/vista/vistaSelectorConvenio.jsf';
export const deviceOmitName = /^omitir(?: por ahora)?$/iu;
const detailedWorkbookLabels = [
  'Fecha de transacción',
  'Código de transacción',
  'Glosa detalle',
  'Ingreso (+)',
  'Egreso (-)',
  'Saldo contable',
] as const;

/** Submits the observed native POST form once while preserving Playwright's navigation lifecycle. */
export async function submitObservedLogin(control: Pick<Locator, 'click'>): Promise<void> {
  await control.click();
}

export function shouldProbeAuthenticatedSession(pageUrl: string, alreadyProbed: boolean): boolean {
  return !alreadyProbed && /\/LoginJSFGenerico(?:[?#]|$)/u.test(pageUrl);
}

export function isAuthenticatedLocation(
  pageUrl: string,
  frameUrls: string[],
  movementControls: number,
  businessRows: number,
): boolean {
  return (/vistaSelectorConvenio\.jsf/iu.test(pageUrl) && businessRows > 0)
    || frameUrls.some((url) => /fe-oss-shell-dashboard/iu.test(url))
    || movementControls === 1;
}

export function isExpiredSessionLocation(pageUrl: string): boolean {
  return /\/seguridad\/loginNoSesion\.jsf(?:[?#]|$)/u.test(pageUrl);
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
  try {
    await locator.first().waitFor({ state: 'visible', timeout: 30_000 });
  } catch {
    throw new PortalError('PORTAL_CHANGED', `Expected exactly one ${description}.`);
  }
  const visible: Locator[] = [];
  for (const candidate of await locator.all()) {
    if (await candidate.isVisible()) visible.push(candidate);
  }
  if (visible.length !== 1) {
    throw new PortalError('PORTAL_CHANGED', `Expected exactly one ${description}.`);
  }
  return visible[0] as Locator;
}

async function requireUniqueVisible(locator: Locator, description: string): Promise<Locator> {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: 30_000 });
  } catch {
    throw new PortalError('PORTAL_CHANGED', `Expected exactly one visible ${description}.`);
  }
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
  private contextClosed = false;
  private activeMovements: { movements: Frame; business: BusinessOption } | undefined;

  private constructor(
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly downloadDirectory: string,
    private readonly profileDirectory: string,
  ) {
    context.on('close', () => { this.contextClosed = true; });
  }

  static async open(profile: string): Promise<PlaywrightBciPymePortal> {
    const stateRoot = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
    const dataRoot = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
    const paths = privateBciPaths(profile, stateRoot, dataRoot);
    await mkdir(paths.profileDirectory, { recursive: true, mode: 0o700 });
    await mkdir(paths.downloadDirectory, { recursive: true, mode: 0o700 });
    await chmod(paths.profileDirectory, 0o700);
    await chmod(paths.downloadDirectory, 0o700);
    const context = await openBrowserSession(paths.profileDirectory, {
      ...browserLaunchOptions(process.env.PORTALES_BROWSER_PROXY),
      downloadsPath: paths.downloadDirectory,
    });
    try {
      const page = context.pages()[0] ?? await context.newPage();
      await page.goto(businessSelectorUrl, { waitUntil: 'domcontentloaded' });
      return new PlaywrightBciPymePortal(context, page, paths.downloadDirectory, paths.profileDirectory);
    } catch (error: unknown) {
      await context.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    try {
      if (!this.contextClosed) await saveBrowserSession(this.context, this.profileDirectory);
    } catch (error: unknown) {
      // A closed browser cannot checkpoint; retain the original operation failure.
      if (!this.contextClosed) throw error;
    } finally {
      await this.context.close();
    }
  }

  async requireAuthenticatedSession(): Promise<void> {
    await requireNoSelectorSystemError(this.page);
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
      /vistaSelectorConvenio\.jsf/iu.test(this.page.url()) ? await (await this.businessRows()).count() : 0,
    )) return;
    if (isExpiredSessionLocation(this.page.url())
      || await this.page.getByRole('button', { name: 'Ingresar', exact: true }).count() > 0) {
      throw new PortalError('SESSION_EXPIRED', 'The BCI session is not authenticated. Run auth login explicitly.');
    }
    throw new PortalError('PORTAL_CHANGED', 'The authenticated BCI shell was not uniquely identifiable.');
  }

  private async businessRows(): Promise<Locator> {
    await requireNoSelectorSystemError(this.page);
    const rows = this.page.locator('tr').filter({
      has: this.page.locator("a[id*='linkConvenio']"),
    });
    try {
      await rows.first().waitFor({ state: 'visible', timeout: 30_000 });
    } catch {
      await requireNoSelectorSystemError(this.page);
      if (isExpiredSessionLocation(this.page.url())) {
        throw new PortalError('SESSION_EXPIRED', 'The BCI session is not authenticated. Run auth login explicitly.');
      }
      throw new PortalError('PORTAL_CHANGED', 'No visible business rows were available. Inspect the business selector in the browser before retrying; do not repeat login based on this error.');
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

  private async openBusiness(businessId: string): Promise<{ dashboard: Frame; business: BusinessOption }> {
    this.activeMovements = undefined;
    await this.page.goto(businessSelectorUrl, { waitUntil: 'domcontentloaded' });
    const businesses = await this.discoverBusinesses();
    const index = businesses.findIndex(({ id }) => id === businessId);
    if (index < 0) throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'The selected business ID was not discovered.');
    const business = businesses[index] as BusinessOption;
    const links = this.page.locator("a[id*='linkConvenio']");
    if (await links.count() !== businesses.length) throw new PortalError('PORTAL_CHANGED', 'Business controls changed before selection.');
    await links.nth(index).click();
    const dashboard = await this.waitForFrame('fe-oss-shell-dashboard');
    return { dashboard, business };
  }

  private async openRecipients(businessId: string): Promise<Frame> {
    const { dashboard } = await this.openBusiness(businessId);
    await (await requireUnique(dashboard.getByText('Mis Destinatarios', { exact: false }), 'Mis Destinatarios control')).click();
    const recipients = await this.waitForFrame('fe-destinatarios-pyme');
    await requireUnique(recipients.getByRole('link', { name: 'Autorizados', exact: true }), 'authorized recipients tab');
    return recipients;
  }

  async listRecipients(businessId: string): Promise<Recipient[]> {
    const frame = await this.openRecipients(businessId);
    const result: Recipient[] = [];
    for (const status of ['authorized', 'pending'] as const) {
      const tab = frame.getByRole('link', { name: status === 'authorized' ? /^Autorizados$/u : /^Por autorizar(?: \d+)?$/u });
      await (await requireUnique(tab, 'recipient status tab')).click();
      const empty = frame.getByText('No existen destinatarios por autorizar', { exact: true });
      const table = frame.getByRole('table');
      try {
        await table.or(empty).first().waitFor({ state: 'visible', timeout: 30_000 });
      } catch {
        throw new PortalError('PORTAL_CHANGED', 'Recipient list did not load. Inspect the selected status tab before retrying.');
      }
      if (await empty.isVisible()) continue;
      const next = await requireUnique(frame.getByRole('button', { name: 'keyboard_arrow_right', exact: true }), 'recipient pagination control');
      if (await next.isEnabled()) {
        throw new PortalError('PORTAL_CHANGED', 'Recipient list has multiple pages; observe pagination before extending this adapter. No partial list was returned.');
      }
      const rows = table.getByRole('row').filter({ has: frame.getByRole('img', { name: 'detalle', exact: true }) });
      const count = await rows.count();
      if (count === 0) throw new PortalError('PORTAL_CHANGED', 'Recipient table contained no identifiable detail controls.');
      for (let index = 0; index < count; index++) {
        await (await requireUnique(rows.nth(index).getByRole('img', { name: 'detalle', exact: true }), 'recipient detail control')).click();
        const modal = await requireUnique(frame.locator('bci-wk-modal').filter({ hasText: 'Detalle del destinatario' }), 'recipient detail modal');
        const pairs = await modal.locator('.modal-row').evaluateAll(elements => elements.map(element => ({
          label: element.querySelector('.modal-row-title')?.textContent.trim() ?? '',
          value: element.querySelector('.modal-row-data')?.textContent.trim() ?? '',
        })));
        const labels = ['Nombre y apellido', 'Nombre corto (alias)', 'RUT', 'Correo electrónico', 'Banco', 'Número de cuenta'];
        if (pairs.length !== labels.length || labels.some(label => pairs.filter(pair => pair.label === label).length !== 1)) {
          throw new PortalError('PORTAL_CHANGED', 'Recipient detail fields changed. Inspect the detail modal before retrying.');
        }
        const values = labels.map(label => pairs.find(pair => pair.label === label)?.value ?? '');
        const [name = '', alias = '', rut = '', email = '', bank = '', accountNumber = ''] = values;
        if (!name || !rut || !bank || !accountNumber) throw new PortalError('PORTAL_CHANGED', 'Recipient details were incomplete.');
        result.push({ status, name, alias, rut, email, bank, accountNumber });
        await (await requireUnique(modal.getByRole('button', { name: 'close', exact: true }), 'recipient detail close control')).click();
        await modal.waitFor({ state: 'hidden', timeout: 30_000 });
      }
    }
    return result;
  }

  async discoverRecipientBanks(businessId: string): Promise<BusinessOption[]> {
    const recipients = await this.openRecipients(businessId);
    await (await requireUnique(recipients.getByRole('button', { name: 'Agregar destinatario', exact: true }), 'Agregar destinatario control')).click();
    const bank = await requireUnique(recipients.getByRole('combobox'), 'recipient bank selector');
    try {
      await recipients.waitForFunction(() => document.querySelectorAll('select option').length > 1, undefined, { timeout: 30_000 });
    } catch {
      throw new PortalError('PORTAL_CHANGED', 'The recipient bank catalog did not load. Inspect the recipient creation form before retrying.');
    }
    const options = await bank.locator('option').evaluateAll(elements => elements.map(element => ({
      id: (element as HTMLOptionElement).value,
      label: element.textContent.trim(),
    })).filter(option => option.id !== '%'));
    if (options.length === 0 || options.some(option => option.id === '' || option.label === '')
      || new Set(options.map(option => option.id)).size !== options.length) {
      throw new PortalError('PORTAL_CHANGED', 'The recipient bank catalog was incomplete or duplicated.');
    }
    return options;
  }

  private async fillRecipientCreation(input: RecipientCreation): Promise<Frame> {
    const banks = await this.discoverRecipientBanks(input.businessId);
    if (!banks.some(bank => bank.id === input.bankId)) throw new PortalError('INVALID_INPUT', 'Select a bank from destinatarios options.');
    const frame = await this.waitForFrame('fe-destinatarios-pyme');
    for (const [name, value] of [
      ['Ingresa el nombre y apellido', input.name], ['Ingresa un nombre corto', input.alias],
      ['Ingresa el RUT', input.rut], ['Ingresa el correo electrónico', input.email],
      ['Ingresa el n° de cuenta', input.accountNumber],
    ] as const) {
      await (await requireUnique(frame.getByRole('textbox', { name, exact: true }), 'recipient form field')).fill(value);
    }
    await (await requireUnique(frame.getByRole('combobox'), 'recipient bank selector')).selectOption(input.bankId);
    const favorite = await requireUnique(frame.getByRole('checkbox', { name: 'Incluir destinatario a Favoritos', exact: true }), 'favorite checkbox');
    if (await favorite.isChecked() !== input.favorite) await this.selectRecipientCheckbox(favorite);
    if (!await frame.getByRole('button', { name: 'Agregar destinatario', exact: true }).isEnabled()) {
      throw new PortalError('INVALID_INPUT', 'BCI did not enable recipient submission. Inspect the form validation; no write was submitted.');
    }
    return frame;
  }

  async prepareRecipientCreation(input: RecipientCreation): Promise<void> {
    await this.fillRecipientCreation(input);
  }

  async createRecipient(input: RecipientCreation, progress: RecipientProgress): Promise<void> {
    const frame = await this.fillRecipientCreation(input);
    try {
      await (await requireUnique(frame.getByRole('button', { name: 'Agregar destinatario', exact: true }), 'recipient submit control')).click();
      // Creation saves the recipient before opening automatic BciPass. The public
      // create operation ends with listing reconciliation; authorize owns phone approval.
      try {
        await frame.getByText('Autoriza Destinatarios con Bcipass', { exact: true })
          .or(frame.getByText('Ocurrió un problema', { exact: true }))
          .or(frame.getByText('Autorización exitosa', { exact: true }))
          .first().waitFor({ state: 'visible', timeout: 60_000 });
      } catch {
        throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'BCI did not reach the observed post-creation state. Run destinatarios list before any further submission.');
      }
      progress('verifying-created-recipient');
    } catch (error: unknown) {
      if (error instanceof PortalError) throw error;
      throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'Recipient submission may have reached BCI. Run destinatarios list before any further submission.');
    }
  }

  private async selectRecipientCheckbox(checkbox: Locator): Promise<void> {
    // Observed native checkbox is off-screen; its zero-height label paints a 24px square.
    const label = checkbox.locator('..').locator('label');
    if (await label.count() !== 1) throw new PortalError('PORTAL_CHANGED', 'Recipient checkbox label changed.');
    const geometry = await label.evaluate(element => {
      const style = getComputedStyle(element, '::before');
      return { width: style.width, height: style.height, left: style.left, top: style.top };
    });
    const box = await label.boundingBox();
    if (!box || geometry.width !== '24px' || geometry.height !== '24px' || geometry.left !== '0px' || geometry.top !== '0px') {
      throw new PortalError('PORTAL_CHANGED', 'Recipient checkbox geometry changed. Inspect the visible control before retrying.');
    }
    const previous = await checkbox.isChecked();
    await this.page.mouse.click(box.x + 12, box.y + 12);
    if (await checkbox.isChecked() === previous) throw new PortalError('PORTAL_CHANGED', 'Recipient checkbox did not change selection.');
  }

  private async openVerifiedRecipientRow(businessId: string, recipient: Recipient): Promise<{ frame: Frame; row: Locator }> {
    const frame = await this.openRecipients(businessId);
    await (await requireUnique(frame.getByRole('link', { name: recipient.status === 'pending' ? /^Por autorizar(?: \d+)?$/u : /^Autorizados$/u }), 'recipient status tab')).click();
    const row = await requireUnique(frame.getByRole('row').filter({ hasText: recipient.name }).filter({ has: frame.getByRole('img', { name: 'detalle', exact: true }) }), 'selected recipient row');
    await (await requireUnique(row.getByRole('img', { name: 'detalle', exact: true }), 'recipient detail control')).click();
    const modal = await requireUnique(frame.locator('bci-wk-modal').filter({ hasText: 'Detalle del destinatario' }), 'recipient detail modal');
    const pairs = await modal.locator('.modal-row').evaluateAll(elements => elements.map(element => [
      element.querySelector('.modal-row-title')?.textContent.trim() ?? '',
      element.querySelector('.modal-row-data')?.textContent.trim() ?? '',
    ]));
    const details: Record<string, string> = Object.fromEntries(pairs.map(pair => [pair[0] ?? '', pair[1] ?? ''] as const));
    if (details['RUT'] !== recipient.rut || details['Número de cuenta'] !== recipient.accountNumber
      || details['Banco'] !== recipient.bank || details['Nombre y apellido'] !== recipient.name
      || details['Nombre corto (alias)'] !== recipient.alias || details['Correo electrónico'] !== recipient.email) {
      throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'Recipient details changed before the operation; no write was submitted.');
    }
    await (await requireUnique(modal.getByRole('button', { name: 'close', exact: true }), 'recipient detail close control')).click();
    await modal.waitFor({ state: 'hidden', timeout: 30_000 });
    return { frame, row };
  }

  async deleteRecipient(businessId: string, recipient: Recipient): Promise<void> {
    const { frame, row } = await this.openVerifiedRecipientRow(businessId, recipient);
    await (await requireUnique(row.getByRole('img', { name: 'eliminar', exact: true }), 'recipient delete preview control')).click();
    const confirmation = await requireUnique(frame.getByRole('row').filter({
      has: frame.getByRole('button', { name: 'Eliminar', exact: true }),
    }), 'recipient delete confirmation');
    if (!hasExactRecipientDeleteQuestion(await confirmation.getByRole('paragraph').allInnerTexts(), recipient.name)) {
      throw new PortalError('PORTAL_CHANGED', 'The deletion question did not identify the exact recipient; no deletion was submitted.');
    }
    try {
      await (await requireUnique(confirmation.getByRole('button', { name: 'Eliminar', exact: true }), 'recipient delete submit control')).click();
      await row.waitFor({ state: 'hidden', timeout: 60_000 });
    } catch {
      throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'The deletion may have reached BCI. Inspect destinatarios list before another deletion; the command never resubmits.');
    }
  }

  async authorizeRecipient(businessId: string, recipient: Recipient, progress: RecipientProgress): Promise<void> {
    const { frame, row } = await this.openVerifiedRecipientRow(businessId, recipient);
    const checkbox = await requireUnique(row.getByRole('checkbox'), 'recipient checkbox');
    if (!await checkbox.isChecked()) await this.selectRecipientCheckbox(checkbox);
    const selected = frame.getByRole('row').filter({ has: frame.getByRole('checkbox', { checked: true }) })
      .filter({ has: frame.getByRole('img', { name: 'detalle', exact: true }) });
    if (await selected.count() !== 1 || !await checkbox.isChecked()) {
      throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'Exactly one recipient must be selected; no approval request was submitted.');
    }
    try {
      await (await requireUnique(frame.getByRole('button', { name: 'Autorizar', exact: true }), 'recipient authorization control')).click();
      await this.waitForRecipientAuthorization(frame, progress);
    } catch (error: unknown) {
      if (error instanceof PortalError) throw error;
      throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'Authorization may have reached BCI. Run destinatarios list before any further approval request.');
    }
  }

  private async waitForRecipientAuthorization(frame: Frame, progress: RecipientProgress): Promise<void> {
    const deadline = Date.now() + 300_000;
    let lastStage = '';
    // Observe this one live request. Never navigate or resubmit while the bank verifies it.
    while (Date.now() < deadline) {
      if (await frame.getByText('Autorización exitosa', { exact: true }).isVisible()) {
        progress('bank-success');
        return;
      }
      if (await frame.getByText('Ocurrió un problema', { exact: true }).isVisible()) {
        // Terminal bank error: the task reconciles the listing, since creation may persist.
        progress('bank-error');
        return;
      }
      const stage = await frame.getByText('Verificando BCIPass', { exact: true }).isVisible()
        ? 'verifying-bcipass' : await frame.getByText('Autoriza Destinatarios con Bcipass', { exact: true }).isVisible()
          ? 'awaiting-bcipass' : undefined;
      if (stage && stage !== lastStage) {
        lastStage = stage;
        progress(stage);
      }
      if (isExpiredSessionLocation(this.page.url())) throw new PortalError('SESSION_EXPIRED', 'The session expired during authorization. Reconcile recipients after explicit login; do not resubmit.');
      await this.page.waitForTimeout(1_000);
    }
    throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'BCI did not reach a recognized terminal result within five minutes. Run destinatarios list before another request; the phone approval alone is not proof of completion.');
  }

  private async openMovements(businessId: string): Promise<{ movements: Frame; business: BusinessOption }> {
    // Account discovery already opened this exact business; export from that verified view.
    if (this.activeMovements?.business.id === businessId
      && !this.activeMovements.movements.isDetached()
      && this.activeMovements.movements.url().includes('fe-oss-shell-mov-cuenta')) {
      return this.activeMovements;
    }
    const { dashboard, business } = await this.openBusiness(businessId);
    const movementLink = dashboard.getByText('Mis Movimientos', { exact: false }).first();
    await movementLink.waitFor({ state: 'visible', timeout: 30_000 });
    await movementLink.click();
    const movements = await this.waitForFrame('fe-oss-shell-mov-cuenta');
    await movements.waitForTimeout(8_000);
    this.activeMovements = { movements, business };
    return this.activeMovements;
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
    const { movements } = await this.openMovements(selection.businessId);
    const accounts = await this.currentAccounts(movements);
    if (accounts.length !== 1 || accounts[0]?.id !== selection.accountId) {
      throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'The selected account is not the current discovered account.');
    }
    await requireUnique(
      movements.locator('fe-oss-widget-accounts-cartola').filter({ hasText: selection.accountId }),
      'selected account widget',
    );
    const downloadButton = movements.getByRole('button', { name: /Descargar/iu }).first();
    try {
      await downloadButton.waitFor({ state: 'visible', timeout: 30_000 });
    } catch {
      throw new PortalError('PORTAL_CHANGED', 'Expected a visible movements download button.');
    }
    await downloadButton.click();
    const option = await requireUniqueVisible(
      movements.getByText(/Descargar excel detallado/iu),
      'Excel detallado download option',
    );
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: 120_000 }),
      option.click(),
    ]);
    const failure = await download.failure();
    if (failure !== null) {
      throw new PortalError('PORTAL_CHANGED', this.contextClosed
        ? 'The browser closed before the cartola download completed.'
        : failure === 'canceled' ? 'The cartola download was cancelled before completion.'
          : 'BCI did not complete the download.');
    }
    const path = join(this.downloadDirectory, `cartola-${randomUUID()}.xlsx`);
    await download.saveAs(path);
    const mediaType: SupportedDownloadMediaType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return validateDownloadedFile(path, mediaType, undefined, detailedWorkbookLabels);
  }
}

/** The selector can serve a system-error page with HTTP 200 at its normal URL. */
async function requireNoSelectorSystemError(page: Page): Promise<void> {
  if (/vistaSelectorConvenio\.jsf/iu.test(page.url())
    && await page.getByText('Algo salió mal', { exact: true }).isVisible()) {
    throw new PortalError(
      'PORTAL_CHANGED',
      'BCI displayed a system-error page instead of the business selector. Authentication cannot be established from this page. Check portal availability in the browser before retrying businesses list; do not repeat login based on this error.',
    );
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
    await page.locator('tr').filter({ has: page.locator("a[id*='linkConvenio']") }).count(),
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
    const context = await openBrowserSession(paths.profileDirectory, browserLaunchOptions(process.env.PORTALES_BROWSER_PROXY));
    let authenticationAccepted = false;
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
      await submitObservedLogin(enter);
      submitted();

      const deadline = Date.now() + 60_000;
      let omittedDeviceRegistration = false;
      let probedAuthenticatedSession = false;
      while (Date.now() < deadline) {
        const pages = context.pages();
        for (const candidate of pages) {
          const stop = await detectedStop(candidate);
          if (stop !== undefined) throw stop;
          if (await hasAuthenticatedShell(candidate)) {
            authenticationAccepted = true;
            accepted();
            return;
          }
        }

        const relay = pages.find((candidate) => shouldProbeAuthenticatedSession(
          candidate.url(), probedAuthenticatedSession,
        ));
        if (relay !== undefined) {
          probedAuthenticatedSession = true;
          await relay.goto(businessSelectorUrl, { waitUntil: 'domcontentloaded' });
          continue;
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
            authenticationAccepted = true;
            accepted();
            await omitControls[0]?.click();
            omittedDeviceRegistration = true;
          }
        }
        await page.waitForTimeout(250);
      }
      throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'The login result could not be verified safely.');
    } finally {
      try {
        if (authenticationAccepted) await saveBrowserSession(context, paths.profileDirectory);
      } finally {
        await context.close();
      }
    }
  }
}
