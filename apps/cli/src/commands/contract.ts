import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { invalidInput } from '../../../../packages/runtime/src/errors.js';
import { type Contract, controlLabel, expectedCountText, listContractFiles, loadContract, validateContractFile } from '../../../../packages/runtime/src/contracts.js';
import { readObservationBundle } from '../../../../packages/runtime/src/observation.js';
import { stateRoot } from '../../../../packages/runtime/src/paths.js';
import type { CommandSpec } from '../../../../packages/runtime/src/registry.js';
import { readRunRecord } from '../../../../packages/runtime/src/runs.js';
import { repositoryRoot } from '../../../../packages/runtime/src/version.js';
import type { CliDependencies } from '../dependencies.js';

type Spec = CommandSpec<CliDependencies>;

async function writePrivate(path: string, content: string): Promise<void> {
  const file = await open(path, 'w', 0o600);
  try { await file.writeFile(content, 'utf8'); } finally { await file.close(); }
}

function scaffoldMarkdown(runId: string, record: { service: string; operation: string; status: string; error: { code: string } | null; stages: { stage: string }[] }, contract: { path: string; contract: Contract } | null, observation: Awaited<ReturnType<typeof readObservationBundle>>): string {
  const lines = [
    `# Contract check for ${runId}`, '',
    `- Service: ${record.service}`, `- Operation: ${record.operation}`, `- Run status: ${record.status}`,
    `- Error: ${record.error === null ? 'none' : record.error.code}`, `- Last stage: ${record.stages.at(-1)?.stage ?? 'none'}`,
    `- Contract: ${contract === null ? 'none found' : `${contract.path} (observed ${contract.contract.observedAt})`}`, '',
    '## Expected vs observed', '', '| State | Control | Expected | Observed |', '| --- | --- | --- | --- |',
  ];
  for (const [name, state] of Object.entries(contract?.contract.pageStates ?? {})) {
    for (const control of state.controls) {
      const observed = observation?.observation.states.find((item) => item.expectedState === name)?.controls.find((item) => item.control === controlLabel(control))?.visibleCount;
      lines.push(`| ${name} | ${controlLabel(control)} | ${expectedCountText(control.expectedVisibleCount)} | ${observed === undefined ? 'not observed' : String(observed)} |`);
    }
  }
  lines.push('', '## Facts (observed)', '', ...(observation?.proposal.facts.map((fact) => `- ${fact}`) ?? ['- (run portales <service> observe <operation> to collect structural facts)']), '');
  lines.push('## Hypotheses (unverified)', '', ...(observation?.proposal.hypotheses.map((item) => `- ${item}`) ?? ['- ']), '');
  lines.push('## Proposed contract diff (for agent review; never applied automatically)', '', '```json', JSON.stringify(observation?.proposal.proposedDiff ?? [], null, 2), '```', '');
  lines.push('## Review checklist', '', '- [ ] Facts reproduced in a headed browser within the safety boundary', '- [ ] Diff limited to the smallest structural change', '- [ ] Local tests updated with synthetic data only', '- [ ] One safe live verification through the public CLI', '- [ ] Dated contract JSON and Markdown updated together', '');
  return `${lines.join('\n')}\n`;
}

export const contractCommands: Spec[] = [
  {
    service: 'portales', path: ['contract', 'validate'], summary: 'Validate every machine-checkable contract JSON in the checkout.',
    effect: 'read', auth: 'public', browser: 'none', profile: 'none',
    output: { description: '{ contracts: [{ path, service, operations, observedAt }] }' }, errors: ['INVALID_INPUT'],
    async run() {
      const root = repositoryRoot();
      const contracts = [];
      for (const path of await listContractFiles(root)) {
        const contract = await validateContractFile(path);
        contracts.push({ path: path.replace(`${root}/`, ''), service: contract.service, operations: contract.operations, observedAt: contract.observedAt, pageStates: Object.keys(contract.pageStates) });
      }
      return { contracts };
    },
  },
  {
    service: 'portales', path: ['contract', 'check'], summary: 'Build a sanitized observation scaffold for one recorded run, outside the repository.',
    description: 'Reads the private run record, the dated contract, and any observation bundle for that run. Never captures raw HTML, screenshots, payloads, or private inputs, and never edits source.',
    effect: 'read', auth: 'public', browser: 'none', profile: 'none',
    positionals: [{ name: 'run-id', kind: 'string', required: true, description: 'Run identifier.', discoverWith: 'portales runs list' }],
    output: { description: '{ scaffold, contractPath, observationBundle, proposedDiffCount }' }, errors: ['INVALID_INPUT'],
    async run(input, context) {
      const runId = input.positionals['run-id'] as string;
      const state = context.deps.stateRoot ?? stateRoot(context.env);
      const record = await readRunRecord(runId, state);
      if (record === null) throw invalidInput('Unknown run id.', [{ field: '<run-id>', expected: 'an id listed by portales runs list', discoverWith: 'portales runs list' }], { nextCommand: 'portales runs list' });
      const contract = await loadContract(repositoryRoot(), record.service, record.operation);
      const observation = await readObservationBundle(runId, state);
      const directory = join(state, 'portales', 'contract-checks', runId);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writePrivate(join(directory, 'scaffold.md'), scaffoldMarkdown(runId, record, contract, observation));
      await writePrivate(join(directory, 'scaffold.json'), `${JSON.stringify({
        schemaVersion: '1', runId, service: record.service, operation: record.operation, contractPath: contract?.path ?? null,
        error: record.error, facts: observation?.proposal.facts ?? [], hypotheses: observation?.proposal.hypotheses ?? [], proposedDiff: observation?.proposal.proposedDiff ?? [],
      }, null, 2)}\n`);
      return { scaffold: join(directory, 'scaffold.md'), contractPath: contract?.path ?? null, observationBundle: observation === null ? null : runId, proposedDiffCount: observation?.proposal.proposedDiff.length ?? 0, nextCommand: observation === null && record.service !== 'portales' && record.operation !== 'observe' && record.operation !== 'verify' ? `portales ${record.service} observe ${record.operation} --profile ${record.profile ?? '<profile>'}` : null };
    },
  },
];
