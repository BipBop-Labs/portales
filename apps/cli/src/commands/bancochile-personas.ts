import { PortalError, invalidInput } from '../../../../packages/runtime/src/errors.js';
import type { CommandSpec, ServiceSpec } from '../../../../packages/runtime/src/registry.js';
import { stateRoot as defaultStateRoot, dataRoot as defaultDataRoot } from '../../../../packages/runtime/src/paths.js';
import type { CliDependencies } from '../dependencies.js';
import { breakerStatus, logout, status } from '../../../../services/bancochile-personas/src/tasks/auth.js';
import { listCuentas, listMovimientos, movementRange, type AccountsPortal } from '../../../../services/bancochile-personas/src/tasks/cuentas.js';
import { executeRecipientWrite, prepareRecipientWrite, type RecipientWrite, type RecipientWritePortal } from '../../../../services/bancochile-personas/src/tasks/destinatarios-write.js';
import { listDestinatarios, showDestinatario, type RecipientQuery, type RecipientsPortal } from '../../../../services/bancochile-personas/src/tasks/destinatarios.js';

type Spec = CommandSpec<CliDependencies>;

const SERVICE_DOC = 'services/bancochile-personas/docs/service.md';
const LOGIN_CONTRACT = 'services/bancochile-personas/docs/contracts/auth-login.md';
const ACCOUNTS_CONTRACT = 'services/bancochile-personas/docs/contracts/cuentas-movimientos.md';
const RECIPIENTS_CONTRACT = 'services/bancochile-personas/docs/contracts/destinatarios.md';
const OBSERVED = '2026-10-30';
const sessionErrors = ['NOT_AUTHENTICATED', 'SESSION_EXPIRED', 'PROVIDER_ERROR', 'READINESS_TIMEOUT', 'CONTRACT_MISMATCH', 'BROWSER_LAUNCH_FAILED', 'RUN_LOCKED'] as const;

function roots(context: Parameters<Spec['run']>[1]) {
  return {
    stateRoot: context.deps.stateRoot ?? defaultStateRoot(context.env),
    dataRoot: context.deps.dataRoot ?? defaultDataRoot(context.env),
  };
}

async function withPortal<T>(context: Parameters<Spec['run']>[1], profile: string, work: (portal: RecipientsPortal & AccountsPortal & RecipientWritePortal) => Promise<T>): Promise<T> {
  if (context.deps.openBancoChilePortal === undefined) throw new PortalError('UNSUPPORTED_CAPABILITY', 'The Banco de Chile portal is not wired in this build.');
  context.stage('session-check');
  const portal = await context.deps.openBancoChilePortal(profile);
  try {
    context.stage('navigate');
    const result = await work(portal);
    context.stage('parse');
    return result;
  } finally {
    await portal.close();
  }
}

const WRITES_CONTRACT = 'services/bancochile-personas/docs/contracts/destinatarios-escritura.md';
const target = [
  { name: 'recipient-id', kind: 'string', required: true, description: 'Recipient ID.', discoverWith: 'portales bancochile-personas destinatarios show --profile <profile> --name <words>' },
  { name: 'account-id', kind: 'string', description: 'Account ID (accounts[].accountId); required for favorite and delete-account.', discoverWith: 'portales bancochile-personas destinatarios show --profile <profile> --id <recipient-id>' },
] as const;
const favoriteOption = { name: 'favorite', kind: 'enum', values: ['true', 'false'], description: 'Target favourite state.' } as const;
const editOptions = [
  { name: 'name', kind: 'string', description: 'New recipient name (accents allowed).' },
  { name: 'alias', kind: 'string', repeatable: true, description: 'New alias for one account, as <account-id>=<alias> (repeatable, up to 100 characters).' },
] as const;

function recipientWrite(action: RecipientWrite['action'], options: Record<string, unknown>): RecipientWrite {
  const recipientId = options['recipient-id'] as string;
  if (action === 'edit') {
    const name = typeof options.name === 'string' ? options.name.trim() : undefined;
    const aliases = ((options.alias as string[] | undefined) ?? []).map((pair) => {
      const separator = pair.indexOf('=');
      const alias = pair.slice(separator + 1).trim();
      if (separator <= 0 || alias.length === 0 || alias.length > 100) {
        throw invalidInput('--alias must be <account-id>=<alias> with 1 to 100 characters.', [{ field: '--alias', expected: '<account-id>=<alias>', received: pair }]);
      }
      return { accountId: pair.slice(0, separator), alias };
    });
    if (name === '' || (name === undefined && aliases.length === 0)) {
      throw invalidInput('Give --name and/or at least one --alias.', [{ field: '--name', expected: 'non-empty name' }, { field: '--alias', expected: '<account-id>=<alias>' }]);
    }
    return { action, recipientId, aliases, ...(name === undefined ? {} : { name }) };
  }
  if (typeof options['account-id'] !== 'string') {
    throw invalidInput('--account-id is required for this action.', [{ field: '--account-id', expected: 'account ID', discoverWith: 'portales bancochile-personas destinatarios show --profile <profile> --id <recipient-id>' }]);
  }
  const ids = { recipientId, accountId: options['account-id'] };
  if (action === 'delete-account') return { action, ...ids };
  if (options.favorite !== 'true' && options.favorite !== 'false') {
    throw invalidInput('--favorite true|false is required for the favorite action.', [{ field: '--favorite', expected: 'true or false' }]);
  }
  return { action, ...ids, favorite: options.favorite === 'true' };
}

const commands: Spec[] = [
  {
    service: 'bancochile-personas', path: ['auth', 'login'], summary: 'Make exactly one explicit Banco de Chile login attempt with the stored credentials.',
    effect: 'read', auth: 'public', browser: 'headed', profile: 'required',
    output: { description: '{ profile, authenticated: true, lastAuthenticatedStage }' },
    errors: ['CREDENTIALS_NOT_CONFIGURED', 'CREDENTIALS_INVALID', 'KEYRING_LOCKED', 'KEYRING_UNAVAILABLE', 'ADDITIONAL_AUTH_REQUIRED', 'ACCOUNT_BLOCKED', 'RATE_LIMITED', 'REMOTE_STATE_AMBIGUOUS', 'CONTRACT_MISMATCH', 'BROWSER_LAUNCH_FAILED', 'RUN_LOCKED'],
    contractRef: `${LOGIN_CONTRACT}#observed-flow`, contractVersion: OBSERVED,
    run(input, context) {
      if (context.deps.loginBancoChilePersonas === undefined) throw new PortalError('UNSUPPORTED_CAPABILITY', 'Banco de Chile login is not wired in this build.');
      context.stage('navigate');
      return context.deps.loginBancoChilePersonas({ profile: input.profile as string });
    },
  },
  {
    service: 'bancochile-personas', path: ['auth', 'status'], summary: 'Local session and breaker status; never opens a browser or submits credentials.',
    effect: 'read', auth: 'public', browser: 'none', profile: 'required',
    output: { description: '{ sessionPresent, savedAt, earliestCookieExpiry, locallyExpired, lastAuthenticatedStage, breaker, newLoginPermitted, liveness: "unknown-local-only" }' },
    errors: ['INVALID_INPUT'], contractRef: `${SERVICE_DOC}#browser-session`,
    run: (input, context) => status({ profile: input.profile as string }, roots(context)),
  },
  {
    service: 'bancochile-personas', path: ['auth', 'logout'], summary: 'Remove local session material (no observed remote logout route; remoteRevoked is always false).',
    effect: 'write', auth: 'public', browser: 'none', profile: 'required',
    output: { description: '{ profile, localSessionRemoved, remoteRevoked: false }' }, errors: ['INVALID_INPUT'],
    contractRef: `${SERVICE_DOC}#browser-session`,
    run: (input, context) => logout({ profile: input.profile as string }, roots(context)),
  },
  {
    service: 'bancochile-personas', path: ['auth', 'breaker', 'status'], summary: 'Login circuit-breaker state for the profile (reset requires human review).',
    effect: 'read', auth: 'public', browser: 'none', profile: 'required',
    output: { description: '{ tripped, trippedAt, newLoginPermitted, resetRequires }' }, errors: ['INVALID_INPUT'],
    contractRef: `${SERVICE_DOC}#circuit-breaker`,
    run: (input, context) => breakerStatus({ profile: input.profile as string }, roots(context)),
  },
  {
    service: 'bancochile-personas', path: ['destinatarios', 'list'], summary: 'List every recipient in the transfer agenda with all their accounts.',
    effect: 'read', auth: 'session', browser: 'headed', profile: 'required',
    output: { description: '{ total, accounts, recipients: [{ id, name, rut, createdAt, accounts: [{ accountId, bank, bankCode, accountType, accountNumber, alias, email, favorite }] }] } (private values)' },
    errors: [...sessionErrors], contractRef: RECIPIENTS_CONTRACT, contractVersion: OBSERVED,
    run: (input, context) => withPortal(context, input.profile as string, (portal) => listDestinatarios({ profile: input.profile as string }, portal)),
  },
  {
    service: 'bancochile-personas', path: ['destinatarios', 'show'], summary: 'Show one recipient and all their accounts (every bank) by ID, RUT or name.',
    description: 'Use exactly one of --id, --rut (any format) or --name (words, case- and accent-insensitive). Several name matches return the candidates with their IDs.',
    effect: 'read', auth: 'session', browser: 'headed', profile: 'required',
    options: [
      { name: 'id', kind: 'string', description: 'Recipient ID.', discoverWith: 'portales bancochile-personas destinatarios list --profile <profile>' },
      { name: 'rut', kind: 'string', description: 'Recipient RUT, dots and dash optional.' },
      { name: 'name', kind: 'string', description: 'Words of the recipient name.' },
    ],
    output: { description: '{ id, name, rut, createdAt, accounts: [{ accountId, bank, bankCode, accountType, accountNumber, alias, email, favorite }] } (private values)' },
    errors: ['INVALID_INPUT', ...sessionErrors], contractRef: RECIPIENTS_CONTRACT, contractVersion: OBSERVED,
    discoverWith: ['portales bancochile-personas destinatarios list --profile <profile>'],
    run: (input, context) => {
      const given = (['id', 'rut', 'name'] as const).filter((key) => typeof input.options[key] === 'string');
      if (given.length !== 1) {
        throw invalidInput('Use exactly one of --id, --rut or --name.', [{ field: 'selection', expected: 'one of --id, --rut, --name' }]);
      }
      const key = given[0] as 'id' | 'rut' | 'name';
      const query = { [key]: input.options[key] as string } as RecipientQuery;
      return withPortal(context, input.profile as string, (portal) => showDestinatario({ profile: input.profile as string, query }, portal));
    },
  },
  {
    service: 'bancochile-personas', path: ['cuentas', 'list'], summary: 'List your own accounts (current accounts, credit lines) with their available balance.',
    effect: 'read', auth: 'session', browser: 'headed', profile: 'required',
    output: { description: '{ accounts: [{ number, type, productCode, label, currency, status, available }] } (private values)' },
    errors: [...sessionErrors], contractRef: ACCOUNTS_CONTRACT, contractVersion: OBSERVED,
    run: (input, context) => withPortal(context, input.profile as string, (portal) => listCuentas({ profile: input.profile as string }, portal)),
  },
  {
    service: 'bancochile-personas', path: ['movimientos', 'list'], summary: 'List the movements of one own account in a date range (at most 45 days, both days included).',
    description: 'Without dates, the portal\'s own default view (about the last 45 days, including movements already made that post on a later business day). With dates, accounting dates, both included, at most 45 days apart; split longer periods into several calls.',
    effect: 'read', auth: 'session', browser: 'headed', profile: 'required',
    options: [
      { name: 'account', kind: 'string', required: true, description: 'Own account number.', discoverWith: 'portales bancochile-personas cuentas list --profile <profile>' },
      { name: 'from', kind: 'string', description: 'First day, YYYY-MM-DD.' },
      { name: 'to', kind: 'string', description: 'Last day, YYYY-MM-DD (default today).' },
    ],
    output: { description: '{ account, range: { from, to } | "portal-default", currency, total, debits, credits, movements: [{ id, date, direction, amount, balance, description, channel, details, documentNumber }] } (private values)' },
    errors: ['INVALID_INPUT', 'UNSUPPORTED_CAPABILITY', ...sessionErrors], contractRef: ACCOUNTS_CONTRACT, contractVersion: OBSERVED,
    discoverWith: ['portales bancochile-personas cuentas list --profile <profile>'],
    run: (input, context) => {
      const dates = {
        ...(typeof input.options.from === 'string' ? { from: input.options.from } : {}),
        ...(typeof input.options.to === 'string' ? { to: input.options.to } : {}),
      };
      movementRange(dates); // fail on bad dates before opening a browser
      return withPortal(context, input.profile as string, (portal) => listMovimientos({ profile: input.profile as string, account: input.options.account as string, ...dates }, portal));
    },
  },
  {
    service: 'bancochile-personas', path: ['destinatarios', 'prepare'], summary: 'Preview a recipient change against the live agenda and return its confirmation. Changes nothing.',
    effect: 'read', auth: 'session', browser: 'headed', profile: 'required',
    options: [
      { name: 'action', kind: 'enum', values: ['favorite', 'delete-account', 'edit'], required: true, description: 'Change to prepare.' },
      ...target, favoriteOption, ...editOptions,
    ],
    output: { description: '{ preview: { action, recipient, account, change, effect }, confirmation, nextCommand }' },
    errors: ['INVALID_INPUT', ...sessionErrors], contractRef: WRITES_CONTRACT, contractVersion: OBSERVED,
    run: (input, context) => {
      const write = recipientWrite(input.options.action as RecipientWrite['action'], input.options);
      return withPortal(context, input.profile as string, (portal) => prepareRecipientWrite({ profile: input.profile as string, write }, portal));
    },
  },
  ...([
    ['favorite', 'write', 'Mark or unmark one recipient account as favourite, once, after confirmation.', 'The portal applies this change immediately, without Mi Pass.'],
    ['delete-account', 'destructive', 'Delete one account of a recipient from the agenda, once, after confirmation. The recipient\'s other accounts stay.', 'The portal applies this change immediately, without Mi Pass.'],
    ['edit', 'write', 'Change a recipient\'s name and/or account aliases, once, after confirmation; may require Mi Pass.', 'When the bank asks for Mi Pass, STDERR reports awaiting-mipass and the command waits up to five minutes for the approval on the phone. Do not stop it or run another command meanwhile.'],
  ] as const).map(([action, effect, summary, note]): Spec => ({
    service: 'bancochile-personas', path: ['destinatarios', action], summary,
    description: `Run destinatarios prepare first and pass its confirmation. ${note} The result is verified by re-reading the agenda and never retried.`,
    effect, auth: 'session', browser: 'headed', profile: 'required',
    options: action === 'favorite' ? [...target, { ...favoriteOption, required: true }] : action === 'edit' ? [target[0], ...editOptions] : [...target],
    confirm: { description: 'Confirmation returned by destinatarios prepare.' },
    output: { description: '{ outcome: "updated" | "deleted" | "unchanged", miPass?, recipient }' },
    errors: ['INVALID_INPUT', 'CONFIRMATION_REQUIRED', 'REMOTE_STATE_AMBIGUOUS', ...sessionErrors], contractRef: WRITES_CONTRACT, contractVersion: OBSERVED,
    discoverWith: ['portales bancochile-personas destinatarios prepare --profile <profile> --action ' + action + ' --recipient-id <id> --account-id <id>'],
    run: (input, context) => {
      const write = recipientWrite(action, input.options);
      if (typeof input.options.confirm !== 'string') {
        throw new PortalError('CONFIRMATION_REQUIRED', `Run destinatarios prepare --action ${action} and pass its --confirm.`, {
          recovery: { nextCommand: `portales bancochile-personas destinatarios prepare --profile ${input.profile as string} --action ${action} --recipient-id <id> --account-id <id>` },
        });
      }
      const confirm = input.options.confirm;
      const progress = (stage: 'awaiting-mipass' | 'verifying-mipass') => {
        context.stderr(JSON.stringify({ schemaVersion: '1', runId: context.runId, service: 'bancochile-personas', operation: `destinatarios.${action}`, stage: 'verify', detail: stage }));
      };
      return withPortal(context, input.profile as string, (portal) => executeRecipientWrite({ profile: input.profile as string, write, confirm, progress }, portal));
    },
  })),
];

export const bancoChilePersonasService: ServiceSpec<CliDependencies> = {
  slug: 'bancochile-personas', title: 'Banco de Chile Personas', description: 'Banco de Chile personal banking: authentication, transfer recipients, own accounts and movements.',
  docs: SERVICE_DOC, commands,
};
