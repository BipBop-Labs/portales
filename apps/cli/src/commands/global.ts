import { PortalError, invalidInput } from '../../../../packages/runtime/src/errors.js';
import { catalogJson, describeSpec, findCommand, type CommandSpec, type Registry } from '../../../../packages/runtime/src/registry.js';
import { listRunRecords, readRunRecord } from '../../../../packages/runtime/src/runs.js';
import { listArtifacts, readArtifact, verifyArtifact } from '../../../../packages/runtime/src/artifacts.js';
import { readVersionInfo } from '../../../../packages/runtime/src/version.js';
import type { CliDependencies } from '../dependencies.js';

type Spec = CommandSpec<CliDependencies>;

const artifactFilters = [
  { name: 'service', kind: 'string', description: 'Filter by service slug.' },
  { name: 'profile', kind: 'string', description: 'Filter by profile.' },
  { name: 'document-type', kind: 'string', description: 'Filter by document type.' },
  { name: 'limit', kind: 'integer', description: 'Maximum items (default 50).' },
] as const;

export function globalCommands(registryRef: () => Registry<CliDependencies>): Spec[] {
  return [
    {
      service: 'portales', path: ['catalog'], summary: 'Complete capability catalog generated from the task registry.',
      effect: 'read', auth: 'public', browser: 'none', profile: 'none', output: { description: '{ services: [...], globals: [...] }' }, errors: [],
      run: () => Promise.resolve(catalogJson(registryRef())),
    },
    {
      service: 'portales', path: ['describe'], summary: 'Contract of one operation: portales describe <service> <resource> <action> --json.',
      effect: 'read', auth: 'public', browser: 'none', profile: 'none', legacy: true, output: { description: 'Operation contract.' }, errors: ['INVALID_INPUT'],
      run(input) {
        const words = input.rest.filter((word) => !word.startsWith('--'));
        const dotted = words.length === 1 ? (words[0] as string).split('.') : words;
        const found = findCommand(registryRef(), dotted);
        if (found === undefined || found.consumed !== dotted.length) {
          throw invalidInput(`Unknown operation: ${words.join(' ')}.`, [{ field: 'operation', expected: '<service> <resource> <action> as listed by portales catalog --json' }], { nextCommand: 'portales catalog --json' });
        }
        return Promise.resolve(describeSpec(found.spec));
      },
    },
    {
      service: 'portales', path: ['version'], summary: 'Package version, commit, build time, checkout, and stale-build status.',
      effect: 'read', auth: 'public', browser: 'none', profile: 'none', output: { description: 'VersionInfo' }, errors: [],
      run: () => readVersionInfo(),
    },
    {
      service: 'portales', path: ['runs', 'list'], summary: 'List private run records (newest first).',
      effect: 'read', auth: 'public', browser: 'none', profile: 'none',
      options: [{ name: 'service', kind: 'string', description: 'Filter by service.' }, { name: 'profile', kind: 'string', description: 'Filter by profile.' }, { name: 'limit', kind: 'integer', description: 'Maximum records (default 50).' }],
      output: { description: '{ runs: [RunRecord summary] }' }, errors: [],
      async run(input, context) {
        const runs = await listRunRecords({
          ...(input.options.service === undefined ? {} : { service: input.options.service as string }),
          ...(input.options.profile === undefined ? {} : { profile: input.options.profile as string }),
          ...(input.options.limit === undefined ? {} : { limit: input.options.limit as number }),
        }, context.deps.stateRoot);
        return { runs: runs.map(({ stages, artifacts, ...summary }) => ({ ...summary, stageCount: stages.length, artifactCount: artifacts.length })) };
      },
    },
    {
      service: 'portales', path: ['runs', 'show'], summary: 'Show one private run record with stage timings, typed error, and artifact descriptors.',
      effect: 'read', auth: 'public', browser: 'none', profile: 'none',
      positionals: [{ name: 'run-id', kind: 'string', required: true, description: 'Run identifier.', discoverWith: 'portales runs list' }],
      output: { description: 'RunRecord' }, errors: ['INVALID_INPUT'],
      async run(input, context) {
        const record = await readRunRecord(input.positionals['run-id'] as string, context.deps.stateRoot);
        if (record === null) throw invalidInput('Unknown run id.', [{ field: '<run-id>', expected: 'an id listed by portales runs list', discoverWith: 'portales runs list' }], { nextCommand: 'portales runs list' });
        return record;
      },
    },
    {
      service: 'portales', path: ['artifacts', 'list'], summary: 'List indexed artifacts (newest first).',
      effect: 'read', auth: 'public', browser: 'none', profile: 'none', options: artifactFilters,
      output: { description: '{ artifacts: [ArtifactDescriptor] }' }, errors: [],
      run: async (input, context) => ({ artifacts: await listArtifacts(filters(input.options), context.deps.dataRoot) }),
    },
    {
      service: 'portales', path: ['artifacts', 'latest'], summary: 'The newest artifact matching the filters.',
      effect: 'read', auth: 'public', browser: 'none', profile: 'none', options: artifactFilters,
      output: { description: 'ArtifactDescriptor' }, errors: ['INVALID_INPUT'],
      async run(input, context) {
        const [latest] = await listArtifacts({ ...filters(input.options), limit: 1 }, context.deps.dataRoot);
        if (latest === undefined) throw invalidInput('No artifact matches the filters.', [{ field: 'filters', expected: 'a service/profile/document-type with indexed artifacts', discoverWith: 'portales artifacts list' }], { nextCommand: 'portales artifacts list' });
        return latest;
      },
    },
    {
      service: 'portales', path: ['artifacts', 'show'], summary: 'Show one artifact descriptor.',
      effect: 'read', auth: 'public', browser: 'none', profile: 'none',
      positionals: [{ name: 'artifact-id', kind: 'string', required: true, description: 'Artifact identifier.', discoverWith: 'portales artifacts list' }],
      output: { description: 'ArtifactDescriptor' }, errors: ['INVALID_INPUT'],
      async run(input, context) {
        const descriptor = await readArtifact(input.positionals['artifact-id'] as string, context.deps.dataRoot);
        if (descriptor === null) throw invalidInput('Unknown artifact id.', [{ field: '<artifact-id>', expected: 'an id listed by portales artifacts list', discoverWith: 'portales artifacts list' }], { nextCommand: 'portales artifacts list' });
        return descriptor;
      },
    },
    {
      service: 'portales', path: ['artifacts', 'verify'], summary: 'Re-check an artifact on disk against its descriptor (size, SHA-256, permissions).',
      effect: 'read', auth: 'public', browser: 'none', profile: 'none',
      positionals: [{ name: 'artifact-id', kind: 'string', required: true, description: 'Artifact identifier.', discoverWith: 'portales artifacts list' }],
      output: { description: '{ artifactId, verified, checks }' }, errors: ['INVALID_INPUT', 'DOWNLOAD_INVALID'],
      async run(input, context) {
        const descriptor = await readArtifact(input.positionals['artifact-id'] as string, context.deps.dataRoot);
        if (descriptor === null) throw invalidInput('Unknown artifact id.', [{ field: '<artifact-id>', expected: 'an id listed by portales artifacts list', discoverWith: 'portales artifacts list' }], { nextCommand: 'portales artifacts list' });
        const checks = await verifyArtifact(descriptor);
        const verified = Object.values(checks).every(Boolean);
        if (!verified) throw new PortalError('DOWNLOAD_INVALID', 'The artifact on disk no longer matches its descriptor.', { recovery: { nextAction: 'Re-download the artifact; do not use the file.', nextCommand: `portales artifacts show ${descriptor.artifactId} --json` } });
        return { artifactId: descriptor.artifactId, verified, checks, path: descriptor.path };
      },
    },
  ];
}

function filters(options: Record<string, unknown>) {
  return {
    ...(options.service === undefined ? {} : { service: options.service as string }),
    ...(options.profile === undefined ? {} : { profile: options.profile as string }),
    ...(options['document-type'] === undefined ? {} : { documentType: options['document-type'] as string }),
    ...(options.limit === undefined ? {} : { limit: options.limit as number }),
  };
}
