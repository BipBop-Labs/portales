import { PortalError, invalidInput } from '../../../../packages/runtime/src/errors.js';
import type { CommandSpec, ServiceSpec } from '../../../../packages/runtime/src/registry.js';
import { stateRoot as defaultStateRoot, dataRoot as defaultDataRoot } from '../../../../packages/runtime/src/paths.js';
import type { CliDependencies } from '../dependencies.js';
import { breakerStatus, logout, status } from '../../../../services/bancochile-personas/src/tasks/auth.js';
import { listDestinatarios, showDestinatario, type RecipientQuery, type RecipientsPortal } from '../../../../services/bancochile-personas/src/tasks/destinatarios.js';

type Spec = CommandSpec<CliDependencies>;

const SERVICE_DOC = 'services/bancochile-personas/docs/service.md';
const LOGIN_CONTRACT = 'services/bancochile-personas/docs/contracts/auth-login.md';
const RECIPIENTS_CONTRACT = 'services/bancochile-personas/docs/contracts/destinatarios.md';
const OBSERVED = '2026-10-30';
const sessionErrors = ['NOT_AUTHENTICATED', 'SESSION_EXPIRED', 'PROVIDER_ERROR', 'READINESS_TIMEOUT', 'CONTRACT_MISMATCH', 'BROWSER_LAUNCH_FAILED', 'RUN_LOCKED'] as const;

function roots(context: Parameters<Spec['run']>[1]) {
  return {
    stateRoot: context.deps.stateRoot ?? defaultStateRoot(context.env),
    dataRoot: context.deps.dataRoot ?? defaultDataRoot(context.env),
  };
}

async function withPortal<T>(context: Parameters<Spec['run']>[1], profile: string, work: (portal: RecipientsPortal) => Promise<T>): Promise<T> {
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
];

export const bancoChilePersonasService: ServiceSpec<CliDependencies> = {
  slug: 'bancochile-personas', title: 'Banco de Chile Personas', description: 'Banco de Chile personal banking: authentication and transfer recipients (accounts and movements follow).',
  docs: SERVICE_DOC, commands,
};
