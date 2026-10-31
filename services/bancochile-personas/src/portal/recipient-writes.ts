import type { Locator, Page, Request, Response } from 'playwright';
import { PortalError } from '../../../../packages/runtime/src/errors.js';
import { appUrl } from './session.js';

const CONTRACT = 'services/bancochile-personas/docs/contracts/destinatarios-escritura.md';

export interface AccountTarget { accountNumber: string; bank: string }

const ambiguous = (message: string) => new PortalError('REMOTE_STATE_AMBIGUOUS', message, {
  recovery: { stage: 'verify', contractRef: CONTRACT, remoteMutationPossible: true, nextCommand: 'portales bancochile-personas destinatarios list --profile <profile>' },
});
const changed = (message: string) => new PortalError('CONTRACT_MISMATCH', `Contract mismatch: ${message} Nothing was submitted.`, {
  recovery: { stage: 'navigate', contractRef: CONTRACT, remoteMutationPossible: false },
});

async function exactlyOne(locator: Locator, description: string): Promise<Locator> {
  await locator.first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);
  const count = await locator.count();
  if (count !== 1) throw changed(`expected exactly one ${description}, observed ${String(count)}.`);
  return locator.first();
}

/** Opens the agenda and narrows its table with the page's own search to the one row of the account. */
async function agendaRow(page: Page, target: AccountTarget): Promise<Locator> {
  await page.goto(`${appUrl}#/tef/transferencia-electronica/agenda`, { waitUntil: 'domcontentloaded' });
  await page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
  const search = await exactlyOne(page.locator('mat-form-field').filter({ has: page.locator('mat-label', { hasText: /^Buscar$/u }) }).locator('input').filter({ visible: true }), 'agenda search field');
  await search.fill(target.accountNumber);
  await page.waitForTimeout(1_000);
  return exactlyOne(page.locator('table tbody tr').filter({ hasText: target.accountNumber }).filter({ hasText: target.bank }), 'agenda row for the account');
}

/** Waits until an element stops moving (two equal positions 300 ms apart), at most 5 s. */
async function settled(page: Page, element: Locator): Promise<void> {
  let previous = '';
  for (let attempt = 0; attempt < 17; attempt += 1) {
    const box = JSON.stringify(await element.boundingBox());
    if (box === previous) return;
    previous = box;
    await page.waitForTimeout(300);
  }
}

/** One click on the row's star; the page sends POST agenda/favorito immediately (no Mi Pass). */
export async function toggleFavorite(page: Page, target: AccountTarget): Promise<void> {
  const row = await agendaRow(page, target);
  const star = await exactlyOne(row.locator('i.icon-ion-android-star.clickable'), 'favourite star in the row');
  const response = page.waitForResponse((reply) => reply.request().method() === 'POST' && new URL(reply.url()).pathname.endsWith('/bff-pper-srv-tnsf-agenda/agenda/favorito'), { timeout: 30_000 });
  await star.click();
  const reply = await response.catch(() => { throw ambiguous('The favourite request was clicked but no answer was observed.'); });
  if (reply.status() !== 200) throw ambiguous(`The favourite request answered HTTP ${String(reply.status())}.`);
}

/** Opens the "Editar destinatario" panel from the agenda row of one of the recipient's accounts and
 *  waits until it has loaded the recipient and re-rendered its account table. */
async function openEditPanel(page: Page, target: AccountTarget): Promise<Locator> {
  const row = await agendaRow(page, target);
  // The panel loads banks, profile and account types, then GET agenda/beneficiarios/id, and only then
  // replaces its account table. A click on the earlier table toggles a discarded row and shows nothing.
  const loaded = page.waitForResponse((reply) => reply.request().method() === 'GET' && new URL(reply.url()).pathname.endsWith('/bff-pper-srv-tnsf-agenda/agenda/beneficiarios/id'), { timeout: 30_000 });
  await (await exactlyOne(row.locator('button').filter({ has: page.locator('i.icon-icon-edit-empty') }), 'edit button in the row')).click();
  const panel = page.locator('mat-dialog-container').filter({ hasText: 'Editar destinatario' });
  await panel.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => { throw changed('the edit panel did not open.'); });
  const reply = await loaded.catch(() => { throw changed('the edit panel did not load the recipient.'); });
  if (reply.status() !== 200) throw changed(`the edit panel's recipient load answered HTTP ${String(reply.status())}.`);
  await page.waitForTimeout(500);
  await settled(page, panel);
  return panel;
}

/** Clicks a control that only opens part of the panel (never submits), repeating up to three times
 *  while the expected element is not shown: right after loading, a click can hit a stale row. */
async function openInPanel(control: Locator, shown: Locator): Promise<void> {
  for (let attempt = 0; attempt < 3 && await shown.count() === 0; attempt += 1) {
    await control.click();
    await shown.first().waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined);
  }
}

/** From the row's edit panel, deletes only that account: trash, then the inline "SI", which sends
 *  DELETE agenda/elimina {idCuenta, idDestinatario} immediately (no Mi Pass). Closes the panel. */
export async function deleteAccount(page: Page, target: AccountTarget): Promise<void> {
  const panel = await openEditPanel(page, target);
  const panelRow = await exactlyOne(panel.locator('tr').filter({ hasText: target.accountNumber }).filter({ hasText: target.bank }), 'account row in the edit panel');
  // The trash only opens an inline question; it changes nothing. Shortly after the panel loads, a click
  // can land on a row the panel is about to re-render and show nothing (observed 2026-10-30), so the
  // opening click is repeated up to three times while no question is shown. SI is clicked once.
  const trash = await exactlyOne(panelRow.locator('bch-button').filter({ has: page.locator('i.icon-icon-trash') }).locator('button'), 'trash button in the panel row');
  const questions = panel.locator('.table-collapsable-content--delete').filter({ hasText: /eliminar este destinario/u });
  await openInPanel(trash, questions);
  const question = await exactlyOne(questions, 'inline delete question');
  // Click the inner <button>: a click on the bch-button host is not handled (observed 2026-10-30).
  const yes = await exactlyOne(question.locator('bch-button[text="SI"]').locator('button'), 'SI button');
  const response = page.waitForResponse((reply) => reply.request().method() === 'DELETE' && new URL(reply.url()).pathname.endsWith('/bff-pper-srv-tnsf-agenda/agenda/elimina'), { timeout: 30_000 });
  await yes.click();
  const deleted = await response.catch(() => { throw ambiguous('SI was clicked but no delete answer was observed.'); });
  if (deleted.status() !== 200) throw ambiguous(`The delete request answered HTTP ${String(deleted.status())}.`);
  await panel.locator('button').filter({ hasText: /^\s*CANCELAR\s*$/u }).first().click().catch(() => undefined);
}

export interface RecipientEdit {
  /** Any account of the recipient, to open its panel. */
  anchor: AccountTarget;
  name?: string;
  aliases: Array<AccountTarget & { alias: string }>;
}

export type EditProgress = (stage: 'awaiting-mipass' | 'verifying-mipass') => void;

const ofdPath = '/bff-pper-srv-tnsf-agenda-ofd/agenda/ofd/editBeneficiarioPersona';

/** Applies a name and alias edit in the panel. The name (2 s after typing) and each "GUARDAR CUENTA"
 *  send the whole recipient to editBeneficiarioPersona: 200 saves it; 401 with a rating asks for Mi
 *  Pass. "AUTORIZA CON MI PASS" is clicked once; the phone approval makes the page send the same
 *  edit with the approved token, and its 200 completes the edit. Nothing is retried. */
export async function editRecipient(page: Page, edit: RecipientEdit, progress: EditProgress): Promise<{ miPass: boolean }> {
  const panel = await openEditPanel(page, edit.anchor);
  const answers: number[] = [];
  let sent = 0;
  const isEdit = (request: Request) => request.method() === 'POST' && new URL(request.url()).pathname.endsWith(ofdPath);
  const listener = (reply: Response) => { if (isEdit(reply.request())) answers.push(reply.status()); };
  const counter = (request: Request) => { if (isEdit(request)) sent += 1; };
  page.on('response', listener);
  page.on('request', counter);
  let submitted = false;
  const nextAnswer = async (seen: number, timeout: number): Promise<number> => {
    const deadline = Date.now() + timeout;
    while (answers.length <= seen && Date.now() < deadline) await page.waitForTimeout(250);
    const answer = answers[seen];
    if (answer === undefined) throw submitted ? ambiguous('The edit was sent but the portal did not answer.') : changed('the edit was not sent.');
    return answer;
  };
  try {
    if (edit.name !== undefined) {
      const name = await exactlyOne(panel.locator('input[formcontrolname="nombreBeneficiario"]').filter({ visible: true }), 'recipient name field');
      const seen = answers.length;
      await name.fill(edit.name);
      submitted = true;
      const status = await nextAnswer(seen, 20_000);
      if (status !== 200 && status !== 401) throw ambiguous(`The name edit answered HTTP ${String(status)}.`);
    }
    for (const change of edit.aliases) {
      const row = await exactlyOne(panel.locator('tr').filter({ hasText: change.accountNumber }).filter({ hasText: change.bank }), 'account row in the edit panel');
      // Every account has a collapsed edit row right after it; all of them bind the same alias control.
      // Only the expanded one has height, and its own "Guardar cuenta" saves that account.
      const form = row.locator('xpath=following-sibling::tr[position() <= 2]').filter({ has: page.locator('input[formcontrolname="alias"]') });
      await exactlyOne(form, 'edit row of the account');
      const pencil = await exactlyOne(row.locator('bch-button').filter({ has: page.locator('i.icon-icon-edit-empty') }).locator('button'), 'edit button in the panel row');
      const expanded = async () => ((await form.boundingBox())?.height ?? 0) > 40;
      for (let attempt = 0; attempt < 3 && !await expanded(); attempt += 1) {
        await pencil.click();
        for (let wait = 0; wait < 8 && !await expanded(); wait += 1) await page.waitForTimeout(250);
      }
      if (!await expanded()) throw changed('the account edit form did not open.');
      await (await exactlyOne(form.locator('input[formcontrolname="alias"]'), 'alias field of the account')).fill(change.alias);
      const save = await exactlyOne(form.locator('bch-button[text="Guardar cuenta"]').locator('button'), 'Guardar cuenta button of the account');
      const seen = answers.length;
      const before = sent;
      await save.click();
      // The first click may only run the async account-type check (GET tipocuenta/valida) and send
      // nothing; a second click is made only when no edit request left (observed 2026-10-30).
      for (let wait = 0; wait < 12 && sent === before; wait += 1) await page.waitForTimeout(250);
      if (sent === before && await expanded()) await save.click();
      submitted = true;
      const status = await nextAnswer(seen, 30_000);
      if (status !== 200 && status !== 401) throw ambiguous(`The account edit answered HTTP ${String(status)}.`);
    }
    if (answers.at(-1) === 200) return { miPass: false };
    await page.waitForTimeout(1_500);
    const declined = panel.getByText(/hemos declinado su operaci[oó]n/u);
    if (await declined.count() > 0) {
      throw new PortalError('AUTHORIZATION_DENIED', 'The bank declined the edit for security reasons before Mi Pass.', { recovery: { stage: 'verify', contractRef: CONTRACT, remoteMutationPossible: false } });
    }
    const authorize = await exactlyOne(panel.locator('label.mi-pass-box').filter({ hasText: /AUTORIZA CON MI PASS/iu }).filter({ visible: true }), 'AUTORIZA CON MI PASS control');
    const seen = answers.length;
    await authorize.click();
    progress('awaiting-mipass');
    const status = await nextAnswer(seen, 5 * 60_000).catch(() => {
      throw ambiguous('Mi Pass was requested but no approved edit was observed within five minutes.');
    });
    progress('verifying-mipass');
    if (status !== 200) throw ambiguous(`The approved edit answered HTTP ${String(status)}.`);
    return { miPass: true };
  } catch (error: unknown) {
    if (submitted && error instanceof PortalError && error.code === 'CONTRACT_MISMATCH') {
      throw ambiguous(`Stopped after part of the edit was sent: ${error.message.replace(/ Nothing was submitted\.$/u, '')}`);
    }
    throw error;
  } finally {
    page.off('response', listener);
    page.off('request', counter);
  }
}
