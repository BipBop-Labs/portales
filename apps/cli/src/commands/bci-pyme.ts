import { readPrivateJson } from '../private-input.js';
import { PortalError, invalidInput } from '../../../../packages/runtime/src/errors.js';
import type { CommandSpec, ServiceSpec } from '../../../../packages/runtime/src/registry.js';
import type { CliDependencies } from '../dependencies.js';
import type { CartolaSelection } from '../../../../services/bci-pyme/src/portal/types.js';
import { stateRoot as defaultStateRoot, dataRoot as defaultDataRoot, configRoot as defaultConfigRoot } from '../../../../packages/runtime/src/paths.js';
import { LoginBreaker } from '../../../../services/bci-pyme/src/auth/login-breaker.js';
import { authLogout, authStatus } from '../../../../services/bci-pyme/src/tasks/auth-status.js';
import { listBusinesses } from '../../../../services/bci-pyme/src/tasks/businesses-list.js';
import { listBusinessOptions } from '../../../../services/bci-pyme/src/tasks/businesses-options.js';
import { downloadCartolas } from '../../../../services/bci-pyme/src/tasks/cartolas-download.js';
import { prepareCartolas } from '../../../../services/bci-pyme/src/tasks/cartolas-prepare.js';
import { readSnapshot } from '../../../../services/bci-pyme/src/tasks/snapshots.js';
import { listAccountOptions, listCartolaOptions } from '../../../../services/bci-pyme/src/tasks/options.js';
import { listDestinatarios } from '../../../../services/bci-pyme/src/tasks/destinatarios-list.js';
import { listDestinatarioOptions } from '../../../../services/bci-pyme/src/tasks/destinatarios-options.js';
import { writeDestinatario } from '../../../../services/bci-pyme/src/tasks/destinatarios-write.js';

type Spec = CommandSpec<CliDependencies>;

const CONTRACT = 'services/bci-pyme/docs/contracts/read-only-browser-flow.md';
const RECIPIENTS_CONTRACT = 'services/bci-pyme/docs/contracts/destinatarios.md';
const OBSERVED = '2026-09-17';
/** auth-login.json and destinatarios.json were last observed on 2026-09-14; only the read-only flow was re-observed. */
const OBSERVED_UNCHANGED = '2026-09-14';
const businessId = {
  name: 'business-id', kind: 'string', required: true, description: 'Portal-native business ID.',
  discoverWith: 'portales bci-pyme businesses list --profile <profile>',
} as const;
const sessionErrors = ['NOT_AUTHENTICATED', 'SESSION_EXPIRED', 'PROVIDER_ERROR', 'READINESS_TIMEOUT', 'CONTRACT_MISMATCH', 'BROWSER_LAUNCH_FAILED', 'RUN_LOCKED', 'ACCOUNT_BLOCKED', 'ADDITIONAL_AUTH_REQUIRED'] as const;

function isSelection(value: unknown): value is CartolaSelection {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.businessId === 'string' && typeof item.accountId === 'string' && item.documentType === 'excel-detallado';
}

async function readPrivateSelections(path: string): Promise<CartolaSelection[]> {
  const parsed = await readPrivateJson(path);
  const selections = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>).selections : undefined;
  if (!Array.isArray(selections) || selections.length === 0 || !selections.every(isSelection)) {
    throw invalidInput('The input file must contain {"selections": [{businessId, accountId, documentType: "excel-detallado"}]}.', [
      { field: 'selections[].businessId', expected: 'discovered business ID', discoverWith: 'portales bci-pyme businesses list --profile <profile>' },
      { field: 'selections[].accountId', expected: 'discovered account ID', discoverWith: 'portales bci-pyme accounts options --profile <profile> --business-id <id>' },
      { field: 'selections[].documentType', expected: 'excel-detallado', discoverWith: 'portales bci-pyme cartolas options' },
    ]);
  }
  return selections;
}

function roots(context: Parameters<Spec['run']>[1]) {
  return {
    stateRoot: context.deps.stateRoot ?? defaultStateRoot(context.env),
    dataRoot: context.deps.dataRoot ?? defaultDataRoot(context.env),
    configRoot: defaultConfigRoot(context.env),
  };
}

async function withPortal<T>(context: Parameters<Spec['run']>[1], profile: string, work: (portal: Awaited<ReturnType<CliDependencies['openSessionPortal']>>) => Promise<T>): Promise<T> {
  context.stage('session-check');
  const portal = await context.deps.openSessionPortal(profile);
  try {
    return await work(portal);
  } finally {
    await portal.close?.();
  }
}

const commands: Spec[] = [
  {
    service: 'bci-pyme', path: ['auth', 'setup'], summary: 'Store BCI credentials in the OS keyring through hidden terminal prompts.',
    effect: 'write', auth: 'interactive', browser: 'none', profile: 'required',
    output: { description: '{ configured: true, profile }' }, errors: ['INVALID_INPUT', 'KEYRING_UNAVAILABLE', 'CREDENTIALS_INVALID'],
    contractRef: 'services/bci-pyme/docs/service.md#credential-setup',
    async run(input, context) {
      if (context.deps.setup === undefined) throw new PortalError('KEYRING_UNAVAILABLE', 'Interactive credential setup is unavailable.');
      return context.deps.setup({ profile: input.profile as string });
    },
  },
  {
    service: 'bci-pyme', path: ['auth', 'login'], summary: 'Make exactly one explicit BCI login attempt with the stored credentials.',
    effect: 'read', auth: 'public', browser: 'headed', profile: 'required',
    output: { description: '{ profile, authenticated: true }' },
    errors: ['CREDENTIALS_NOT_CONFIGURED', 'CREDENTIALS_INVALID', 'KEYRING_LOCKED', 'KEYRING_UNAVAILABLE', 'LOGIN_FAILED', 'ADDITIONAL_AUTH_REQUIRED', 'ACCOUNT_BLOCKED', 'RATE_LIMITED', 'REMOTE_STATE_AMBIGUOUS', 'CONTRACT_MISMATCH', 'BROWSER_LAUNCH_FAILED', 'RUN_LOCKED'],
    contractRef: `${CONTRACT}#authentication-breaker-boundary`, contractVersion: OBSERVED_UNCHANGED,
    run(input, context) {
      context.stage('navigate');
      return context.deps.login({ profile: input.profile as string });
    },
  },
  {
    service: 'bci-pyme', path: ['auth', 'status'], summary: 'Local session and breaker status; never opens a browser or submits credentials.',
    effect: 'read', auth: 'public', browser: 'none', profile: 'required',
    output: { description: '{ sessionPresent, savedAt, earliestCookieExpiry, locallyExpired, lastAuthenticatedStage, breaker, newLoginPermitted, liveness: "unknown-local-only" }' },
    errors: ['INVALID_INPUT'], contractRef: 'services/bci-pyme/docs/service.md#browser-session',
    run: (input, context) => authStatus({ profile: input.profile as string }, roots(context)),
  },
  {
    service: 'bci-pyme', path: ['auth', 'logout'], summary: 'Remove local BCI session material (no observed remote logout route; remoteRevoked is always false).',
    effect: 'write', auth: 'public', browser: 'none', profile: 'required',
    output: { description: '{ profile, localSessionRemoved, remoteRevoked: false }' }, errors: ['INVALID_INPUT'],
    contractRef: 'services/bci-pyme/docs/service.md#browser-session',
    run: (input, context) => authLogout({ profile: input.profile as string }, roots(context)),
  },
  {
    service: 'bci-pyme', path: ['auth', 'breaker', 'status'], summary: 'Login circuit-breaker state for the profile (reset requires human review).',
    effect: 'read', auth: 'public', browser: 'none', profile: 'required',
    output: { description: '{ tripped, trippedAt, newLoginPermitted, resetRequires }' }, errors: ['INVALID_INPUT'],
    contractRef: 'services/bci-pyme/docs/service.md#circuit-breaker',
    run: (input, context) => new LoginBreaker(roots(context).stateRoot).status(input.profile as string),
  },
  {
    service: 'bci-pyme', path: ['businesses', 'options'], summary: 'Business catalog, optionally with nested accounts, discovered in one session.',
    effect: 'read', auth: 'session', browser: 'headed', profile: 'required',
    options: [{ name: 'tree', kind: 'boolean', description: 'Include every business\'s accounts (one session, one call).' }],
    output: { description: '{ field: "business-id", options: [{ id, label, aliases, accounts? }], observedAt, source: "live", contractVersion, freshness }' }, errors: [...sessionErrors],
    contractRef: `${CONTRACT}#observed-flow`, contractVersion: OBSERVED,
    run: (input, context) => withPortal(context, input.profile as string, async (portal) => {
      context.stage('navigate');
      const result = await listBusinessOptions({ profile: input.profile as string, tree: input.options.tree === true }, portal);
      context.stage('parse');
      return result;
    }),
  },
  {
    service: 'bci-pyme', path: ['businesses', 'list'], summary: 'List the businesses available to the authenticated session.',
    effect: 'read', auth: 'session', browser: 'headed', profile: 'required',
    output: { description: '{ businesses: [{ id, label }] }' }, errors: [...sessionErrors],
    contractRef: `${CONTRACT}#observed-flow`, contractVersion: OBSERVED,
    run: (input, context) => withPortal(context, input.profile as string, async (portal) => {
      context.stage('navigate');
      const result = await listBusinesses({ profile: input.profile as string }, portal);
      context.stage('parse');
      return result;
    }),
  },
  {
    service: 'bci-pyme', path: ['accounts', 'options'], summary: 'Discover the account IDs valid for one exact business.',
    effect: 'read', auth: 'session', browser: 'headed', profile: 'required', options: [businessId],
    output: { description: '{ field: "account-id", dependsOn: { businessId }, options: [{ id, label, aliases }] }' }, errors: ['INVALID_INPUT', ...sessionErrors],
    contractRef: `${CONTRACT}#observed-flow`, contractVersion: OBSERVED, discoverWith: ['portales bci-pyme businesses list --profile <profile>'],
    run: (input, context) => withPortal(context, input.profile as string, async (portal) => {
      context.stage('navigate');
      const result = await listAccountOptions({ profile: input.profile as string, businessId: input.options['business-id'] as string }, portal);
      context.stage('parse');
      return result;
    }),
  },
  {
    service: 'bci-pyme', path: ['cartolas', 'options'], summary: 'List the supported cartola document types (local catalog, no portal contact).',
    effect: 'read', auth: 'public', browser: 'none', profile: 'none',
    output: { description: '{ field: "document-type", dependsOn: {}, options: [...] }' }, errors: [],
    contractRef: `${CONTRACT}#observed-flow`, contractVersion: OBSERVED,
    run: () => Promise.resolve(listCartolaOptions()),
  },
  {
    service: 'bci-pyme', path: ['cartolas', 'prepare'], summary: 'Resolve business/account labels once, validate dependencies, and return a short-lived snapshot for cartolas download.',
    description: 'Use --business/--account (repeatable, paired in order) or --input {"requests":[{business, account}]}. Labels must resolve uniquely; the snapshot expires after 15 minutes.',
    effect: 'read', auth: 'session', browser: 'headed', profile: 'required',
    options: [
      { name: 'business', kind: 'string', repeatable: true, description: 'Business label or ID (paired with --account in order).', discoverWith: 'portales bci-pyme businesses options --profile <profile> --tree' },
      { name: 'account', kind: 'string', repeatable: true, description: 'Account label or ID.', discoverWith: 'portales bci-pyme businesses options --profile <profile> --tree' },
      { name: 'input', kind: 'path', description: 'Private JSON (mode 0600) with {"requests": [{"business", "account"}]}.' },
    ],
    output: { description: '{ snapshotId, expiresAt, fingerprint, selections, resolved, observedAt, source, nextCommand }' }, errors: ['INVALID_INPUT', ...sessionErrors],
    contractRef: `${CONTRACT}#observed-flow`, contractVersion: OBSERVED,
    discoverWith: ['portales bci-pyme businesses options --profile <profile> --tree'],
    run: async (input, context) => {
      const profile = input.profile as string;
      const businessesFlag = (input.options.business as string[] | undefined) ?? [];
      const accountsFlag = (input.options.account as string[] | undefined) ?? [];
      let requests: { business: string; account: string }[];
      if (input.options.input !== undefined) {
        if (businessesFlag.length > 0 || accountsFlag.length > 0) throw invalidInput('Use either --input or --business/--account, not both.', [{ field: '--input', expected: 'absent when --business/--account are used' }]);
        const parsed = await readPrivateJson(input.options.input as string);
        const list = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>).requests : undefined;
        if (!Array.isArray(list) || list.length === 0 || !list.every((item) => typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).business === 'string' && typeof (item as Record<string, unknown>).account === 'string')) {
          throw invalidInput('The input file must contain {"requests": [{"business", "account"}]}.', [{ field: 'requests[]', expected: '{business: label|id, account: label|id}' }]);
        }
        requests = list as { business: string; account: string }[];
      } else {
        if (businessesFlag.length === 0 || businessesFlag.length !== accountsFlag.length) {
          throw invalidInput('Provide --business and --account in pairs, or --input.', [
            { field: '--business', expected: 'one label or ID per --account', discoverWith: `portales bci-pyme businesses options --profile ${profile} --tree` },
          ], { nextCommand: `portales bci-pyme businesses options --profile ${profile} --tree` });
        }
        requests = businessesFlag.map((business, index) => ({ business, account: accountsFlag[index] as string }));
      }
      return withPortal(context, profile, async (portal) => {
        context.stage('navigate');
        const result = await prepareCartolas({ profile, requests }, portal, roots(context).stateRoot);
        context.stage('parse');
        return result;
      });
    },
  },
  {
    service: 'bci-pyme', path: ['cartolas', 'download'], summary: 'Download validated cartolas and place them directly in their private destination.',
    description: 'Selection sources: --snapshot from cartolas prepare (preferred), --input batch, or --business-id with --account-id. Placement: --output <private dir>, --destination <alias from the private destinations config>, or the default isolated directory service/profile/documentType/businessId/accountId. Every download returns a complete artifact descriptor.',
    effect: 'read', auth: 'session', browser: 'headed', profile: 'required',
    options: [
      { name: 'snapshot', kind: 'string', description: 'snapshotId returned by cartolas prepare (rejected when expired or when live options changed).', discoverWith: 'portales bci-pyme cartolas prepare --profile <profile> --business <label> --account <label>' },
      { name: 'input', kind: 'path', description: 'Private JSON file (mode 0600) with {"selections": [...]}.' },
      { ...businessId, required: false, description: 'Single-selection business ID (with --account-id).' },
      { name: 'account-id', kind: 'string', description: 'Single-selection account ID.', discoverWith: 'portales bci-pyme accounts options --profile <profile> --business-id <business-id>' },
      { name: 'document-type', kind: 'enum', values: ['excel-detallado'], default: 'excel-detallado', description: 'Document type.', discoverWith: 'portales bci-pyme cartolas options' },
      { name: 'output', kind: 'path', description: 'Existing private (0700) directory outside any repository where verified files are placed.' },
      { name: 'destination', kind: 'string', description: 'Alias from the private destinations config (~/.config/portales/destinations.json).' },
    ],
    output: { description: '{ downloads: [artifact descriptor + businessId + accountId + destinationSource], snapshotId }' }, errors: ['INVALID_INPUT', 'SNAPSHOT_EXPIRED', 'SNAPSHOT_STALE', 'DOWNLOAD_INVALID', ...sessionErrors],
    contractRef: `${CONTRACT}#observed-flow`, contractVersion: OBSERVED,
    discoverWith: ['portales bci-pyme cartolas prepare --profile <profile> ...', 'portales bci-pyme businesses options --profile <profile> --tree', 'portales bci-pyme cartolas options'],
    run: async (input, context) => {
      const profile = input.profile as string;
      const single = input.options['business-id'] !== undefined || input.options['account-id'] !== undefined;
      const sources = [input.options.snapshot !== undefined, input.options.input !== undefined, single].filter(Boolean).length;
      if (sources > 1) {
        throw invalidInput('Use exactly one selection source: --snapshot, --input, or --business-id with --account-id.', [{ field: 'selection', expected: 'one of --snapshot, --input, --business-id/--account-id' }]);
      }
      let selections: CartolaSelection[] | undefined;
      if (single) {
        if (input.options['business-id'] === undefined || input.options['account-id'] === undefined) {
          throw invalidInput('A single selection needs both --business-id and --account-id.', [
            { field: '--business-id', expected: 'discovered business ID', discoverWith: `portales bci-pyme businesses list --profile ${profile}` },
            { field: '--account-id', expected: 'discovered account ID', discoverWith: `portales bci-pyme accounts options --profile ${profile} --business-id <business-id>` },
          ]);
        }
        selections = [{ businessId: input.options['business-id'] as string, accountId: input.options['account-id'] as string, documentType: 'excel-detallado' }];
      } else if (input.options.input !== undefined) {
        selections = await readPrivateSelections(input.options.input as string);
      } else if (input.options.snapshot === undefined) {
        throw invalidInput('Provide --snapshot <id>, --input <private-json>, or --business-id with --account-id.', [
          { field: '--snapshot', expected: 'snapshotId from cartolas prepare', discoverWith: `portales bci-pyme cartolas prepare --profile ${profile} --business <label> --account <label>` },
        ], { nextCommand: `portales bci-pyme cartolas prepare --profile ${profile} --business <label> --account <label>` });
      }
      // Snapshot validity (profile, expiry) is checked before any browser session is opened.
      const snapshot = input.options.snapshot === undefined ? undefined : await readSnapshot(input.options.snapshot as string, profile, roots(context).stateRoot);
      return withPortal(context, profile, async (portal) => {
        context.stage('navigate');
        const result = await downloadCartolas({
          profile, ...(selections === undefined ? {} : { selections }),
          ...(snapshot === undefined ? {} : { snapshot }),
          ...(input.options.output === undefined ? {} : { output: input.options.output as string }),
          ...(input.options.destination === undefined ? {} : { destination: input.options.destination as string }),
        }, portal, roots(context));
        context.stage('verify');
        const downloads = [];
        for (const item of result.downloads) {
          const artifact = await context.recordArtifact({
            identifiers: { businessId: item.businessId, accountId: item.accountId }, documentType: item.documentType,
            extractedAt: new Date().toISOString(), coveredPeriod: null, byteCount: item.byteCount, mediaType: item.mediaType,
            sha256: item.sha256, validationChecks: item.validationChecks, path: item.path,
          });
          downloads.push({ ...artifact, businessId: item.businessId, accountId: item.accountId, destinationSource: item.destinationSource });
        }
        return { downloads, snapshotId: result.snapshotId };
      });
    },
  },
  {
    service: 'bci-pyme', path: ['destinatarios', 'list'], summary: 'List transfer recipients registered for one business.',
    effect: 'read', auth: 'session', browser: 'headed', profile: 'required', options: [businessId],
    output: { description: '{ recipients: [...] }' }, errors: ['INVALID_INPUT', ...sessionErrors],
    contractRef: RECIPIENTS_CONTRACT, contractVersion: OBSERVED_UNCHANGED,
    run: (input, context) => withPortal(context, input.profile as string, async (portal) => {
      context.stage('navigate');
      const result = await listDestinatarios({ profile: input.profile as string, businessId: input.options['business-id'] as string }, portal);
      context.stage('parse');
      return result;
    }),
  },
  {
    service: 'bci-pyme', path: ['destinatarios', 'options'], summary: 'Discover recipient banks valid for one business.',
    effect: 'read', auth: 'session', browser: 'headed', profile: 'required', options: [businessId],
    output: { description: '{ field: "bank-id", dependsOn: { businessId }, options: [...] }' }, errors: ['INVALID_INPUT', ...sessionErrors],
    contractRef: RECIPIENTS_CONTRACT, contractVersion: OBSERVED_UNCHANGED,
    run: (input, context) => withPortal(context, input.profile as string, async (portal) => {
      context.stage('navigate');
      const result = await listDestinatarioOptions({ profile: input.profile as string, businessId: input.options['business-id'] as string }, portal);
      context.stage('parse');
      return result;
    }),
  },
  ...(['prepare', 'create', 'authorize', 'delete'] as const).map((action): Spec => ({
    service: 'bci-pyme', path: ['destinatarios', action],
    summary: action === 'prepare' ? 'Validate a recipient write against live options and return its confirmation fingerprint.' : `Execute a previously prepared recipient ${action} once, after explicit confirmation.`,
    effect: action === 'prepare' ? 'read' : action === 'delete' ? 'destructive' : 'write', auth: 'session', browser: 'headed', profile: 'required',
    options: [
      { name: 'input', kind: 'path', required: true, description: 'Private JSON file (mode 0600) with the recipient payload.' },
      ...(action === 'prepare' ? [{ name: 'action', kind: 'enum', values: ['create', 'authorize', 'delete'], required: true, description: 'Write to prepare.' } as const] : []),
    ],
    ...(action === 'prepare' ? {} : { confirm: { description: 'Fingerprint returned by destinatarios prepare.' } }),
    output: { description: action === 'prepare' ? '{ preview, confirmation }' : '{ verified result of the single write }' },
    errors: ['INVALID_INPUT', 'CONFIRMATION_REQUIRED', 'REMOTE_STATE_AMBIGUOUS', ...sessionErrors],
    contractRef: RECIPIENTS_CONTRACT, contractVersion: OBSERVED_UNCHANGED,
    discoverWith: ['portales bci-pyme destinatarios options --profile <profile> --business-id <id>'],
    run: async (input, context) => {
      const preview = action === 'prepare';
      const writeAction = preview ? input.options.action as 'create' | 'authorize' | 'delete' : action;
      const value = await readPrivateJson(input.options.input as string);
      if (!preview && input.options.confirm === undefined) {
        throw new PortalError('CONFIRMATION_REQUIRED', `Pass --confirm with the fingerprint from destinatarios prepare --action ${writeAction}.`, { recovery: { nextCommand: `portales bci-pyme destinatarios prepare --profile ${input.profile as string} --action ${writeAction} --input <private-json>` } });
      }
      const confirmation = input.options.confirm as string | undefined;
      return withPortal(context, input.profile as string, async (portal) => {
        context.stage('navigate');
        return writeDestinatario({ profile: input.profile as string, action: writeAction, value, preview, ...(confirmation === undefined ? {} : { confirmation }) }, portal,
          (stage) => { context.stderr(JSON.stringify({ schemaVersion: '1', runId: context.runId, service: 'bci-pyme', operation: `destinatarios.${writeAction}`, stage: 'verify', detail: stage })); });
      });
    },
  })),
];

export const bciPymeService: ServiceSpec<CliDependencies> = {
  slug: 'bci-pyme', title: 'BCI Pyme', description: 'BCI business banking: businesses, accounts, cartola downloads, transfer recipients.',
  docs: 'services/bci-pyme/docs/service.md', commands,
};
