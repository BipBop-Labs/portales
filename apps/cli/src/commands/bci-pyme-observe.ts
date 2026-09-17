import { PortalError, invalidInput } from '../../../../packages/runtime/src/errors.js';
import { type Contract, controlLabel, listContractFiles, loadContract, validateContractFile } from '../../../../packages/runtime/src/contracts.js';
import { type Observation, proposeContractDiff, sanitizeAriaSnapshot, writeObservationBundle } from '../../../../packages/runtime/src/observation.js';
import type { Classification, PageDescription } from '../../../../packages/runtime/src/page-state.js';
import { stateRoot } from '../../../../packages/runtime/src/paths.js';
import type { CommandSpec } from '../../../../packages/runtime/src/registry.js';
import { repositoryRoot } from '../../../../packages/runtime/src/version.js';
import type { CliDependencies } from '../dependencies.js';
import { listBusinesses } from '../../../../services/bci-pyme/src/tasks/businesses-list.js';
import { listAccountOptions } from '../../../../services/bci-pyme/src/tasks/options.js';

type Spec = CommandSpec<CliDependencies>;
const OBSERVABLE = ['businesses.list', 'accounts.options', 'cartolas.download'] as const;
const CONTRACT = 'services/bci-pyme/docs/contracts/read-only-browser-flow.json';

interface ObservingPortal {
  observe(operation: typeof OBSERVABLE[number], input: { businessId?: string }): Promise<{ states: Array<{ expectedState: string; description: PageDescription; classification: Classification; ariaSnapshot: string }>; stoppedBefore: string | null }>;
}

function canObserve(portal: unknown): portal is ObservingPortal {
  return typeof portal === 'object' && portal !== null && typeof (portal as { observe?: unknown }).observe === 'function';
}

function markerLabel(marker: { role?: string | undefined; name?: string | undefined; css?: string | undefined; text?: string | undefined }): string {
  return controlLabel(marker);
}

export const bci_pyme_observeCommands: Spec[] = [
  {
    service: 'bci-pyme', path: ['observe'], summary: 'Read-only structural observation of one operation; writes a private diagnostic bundle and a sanitized contract-diff proposal.',
    description: 'Never logs in, never submits, never downloads. Captures only page states, control roles/names/counts, frame names, sanitized routes, readiness markers and value-stripped aria snapshots.',
    effect: 'read', auth: 'session', browser: 'headed', profile: 'required',
    positionals: [{ name: 'operation', kind: 'enum', values: OBSERVABLE, required: true, description: 'Operation whose contract states are observed.' }],
    options: [{ name: 'business-id', kind: 'string', description: 'Business to open for accounts/cartolas states (default: first discovered).', discoverWith: 'portales bci-pyme businesses list --profile <profile>' }],
    output: { description: '{ bundle, facts, hypotheses, proposedDiff, stoppedBefore }' },
    errors: ['INVALID_INPUT', 'NOT_AUTHENTICATED', 'SESSION_EXPIRED', 'PROVIDER_ERROR', 'ACCOUNT_BLOCKED', 'BROWSER_LAUNCH_FAILED', 'RUN_LOCKED'],
    contractRef: CONTRACT, contractVersion: '2026-09-17',
    async run(input, context) {
      const operation = input.positionals.operation as typeof OBSERVABLE[number];
      const profile = input.profile as string;
      context.stage('session-check');
      const portal = await context.deps.openSessionPortal(profile);
      try {
        if (!canObserve(portal)) throw new PortalError('UNSUPPORTED_CAPABILITY', 'This portal adapter does not support observation mode.');
        await portal.requireAuthenticatedSession();
        context.stage('navigate');
        const observed = await portal.observe(operation, input.options['business-id'] === undefined ? {} : { businessId: input.options['business-id'] as string });
        context.stage('parse');
        const loaded = await loadContract(repositoryRoot(), 'bci-pyme', operation);
        const observation: Observation = {
          schemaVersion: '1', runId: context.runId, service: 'bci-pyme', operation, observedAt: new Date().toISOString(), browserMode: context.browserMode,
          states: observed.states.map((state) => {
            const expected = loaded?.contract.pageStates[state.expectedState];
            return {
              expectedState: state.expectedState,
              classification: state.classification,
              routeFragment: state.description.routePath,
              frameNames: state.description.frameNames,
              controls: Object.entries(state.description.controlCounts).map(([control, visibleCount]) => ({ control, visibleCount })),
              readinessMarkers: (expected?.readinessMarkers ?? []).map((marker) => ({ marker: markerLabel(marker), present: (state.description.controlCounts[markerLabel(marker)] ?? 0) > 0 || state.classification.kind !== 'changed' })),
              ariaSnapshot: sanitizeAriaSnapshot(state.ariaSnapshot),
            };
          }),
          responseFingerprints: {},
          stoppedBefore: observed.stoppedBefore,
        };
        const proposal = proposeContractDiff(context.runId, loaded, observation);
        context.stage('verify');
        const bundle = await writeObservationBundle(observation, proposal, context.deps.stateRoot ?? stateRoot(context.env));
        return { bundle, contractPath: proposal.contractPath, facts: proposal.facts, hypotheses: proposal.hypotheses, proposedDiff: proposal.proposedDiff, stoppedBefore: observation.stoppedBefore, states: observation.states.map((state) => ({ expectedState: state.expectedState, kind: state.classification.kind, diff: state.classification.diff })) };
      } finally {
        await portal.close?.();
      }
    },
  },
  {
    service: 'bci-pyme', path: ['verify'], summary: 'Verify the BCI contract locally; with --live, exercise read-only public commands and compare with the contract.',
    description: 'Without --live the result states live: false. Local checks are never reported as live verification.',
    effect: 'read', auth: 'public', browser: 'headed', profile: 'optional',
    options: [{ name: 'live', kind: 'boolean', description: 'Exercise businesses list and accounts options against the real portal (read-only).' }],
    output: { description: '{ live, contracts: [...], verified: [...] }' },
    errors: ['INVALID_INPUT', 'NOT_AUTHENTICATED', 'SESSION_EXPIRED', 'PROVIDER_ERROR', 'CONTRACT_MISMATCH', 'RUN_LOCKED'],
    contractRef: CONTRACT, contractVersion: '2026-09-17',
    async run(input, context) {
      const root = repositoryRoot();
      const contracts: Array<{ path: string; operations: string[]; observedAt: string }> = [];
      for (const path of (await listContractFiles(root)).filter((item) => item.includes('/bci-pyme/'))) {
        const contract: Contract = await validateContractFile(path);
        contracts.push({ path: path.replace(`${root}/`, ''), operations: contract.operations, observedAt: contract.observedAt });
      }
      if (input.options.live !== true) {
        return { live: false, contracts, verified: [], note: 'Local contract validation only. Pass --live for read-only portal verification.' };
      }
      const profile = input.profile ?? 'default';
      context.stage('session-check');
      const portal = await context.deps.openSessionPortal(profile);
      const verified: Array<{ operation: string; state: string; ok: true }> = [];
      try {
        context.stage('navigate');
        const { businesses } = await listBusinesses({ profile }, portal);
        if (businesses.length === 0 || businesses.some(({ id, label }) => id === '' || label === '')) {
          throw new PortalError('CONTRACT_MISMATCH', 'businesses.list returned no complete business rows.', { recovery: { contractRef: CONTRACT, nextCommand: `portales bci-pyme observe businesses.list --profile ${profile}` } });
        }
        verified.push({ operation: 'businesses.list', state: 'business-selector', ok: true });
        const first = businesses[0] as { id: string };
        const accounts = await listAccountOptions({ profile, businessId: first.id }, portal);
        if (accounts.options.length !== 1) {
          throw new PortalError('CONTRACT_MISMATCH', `accounts.options: expected exactly 1 current account, observed ${String(accounts.options.length)}.`, { recovery: { contractRef: CONTRACT, nextCommand: `portales bci-pyme observe accounts.options --profile ${profile}` } });
        }
        verified.push({ operation: 'accounts.options', state: 'movements', ok: true });
        context.stage('verify');
        return { live: true, contracts, verified, verifiedAt: new Date().toISOString() };
      } finally {
        await portal.close?.();
      }
    },
  },
];

export function requireObservableOperation(value: string): typeof OBSERVABLE[number] {
  if (!(OBSERVABLE as readonly string[]).includes(value)) {
    throw invalidInput(`Unknown observable operation ${value}.`, [{ field: '<operation>', expected: `one of: ${OBSERVABLE.join(', ')}` }]);
  }
  return value as typeof OBSERVABLE[number];
}
