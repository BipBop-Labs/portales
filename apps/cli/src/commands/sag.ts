import { readPrivateJson } from '../private-input.js';
import type { CommandSpec, ServiceSpec } from '../../../../packages/runtime/src/registry.js';
import type { CliDependencies } from '../dependencies.js';
import { listSagOptions } from '../../../../services/sag/src/tasks/options.js';
import { previewSagDeclaration } from '../../../../services/sag/src/tasks/preview.js';
import { downloadSagDeclaration } from '../../../../services/sag/src/tasks/download.js';

type Spec = CommandSpec<CliDependencies>;
const fields = ['nationality', 'origin-country', 'gender', 'travel-document', 'entry-mode', 'border-control', 'transport-type', 'arrival-date', 'auth-method', 'minors-luggage', 'sag-products'] as const;

const commands: Spec[] = [
  {
    service: 'sag', path: ['declaracion-jurada', 'options'], summary: 'List SAG declaration catalogs (public, no declaration is created).',
    description: 'border-control requires --entry-mode; transport-type and arrival-date require --border-control. No field returns every catalog grouped by parent.',
    effect: 'read', auth: 'public', browser: 'none', profile: 'none',
    positionals: [{ name: 'field', kind: 'enum', values: fields, required: false, description: 'Catalog to list.' }],
    options: [
      { name: 'entry-mode', kind: 'string', description: 'Parent entry mode ID.', discoverWith: 'portales sag declaracion-jurada options entry-mode' },
      { name: 'border-control', kind: 'string', description: 'Parent border control ID.', discoverWith: 'portales sag declaracion-jurada options border-control --entry-mode <id>' },
    ],
    output: { description: '{ field, dependsOn, options } or { catalogs: [...] }' }, errors: ['INVALID_INPUT', 'PROVIDER_ERROR', 'CONTRACT_MISMATCH'],
    contractRef: 'services/sag/docs/contracts/options.md',
    run: (input, context) => {
      context.stage('navigate');
      return listSagOptions({
        ...(input.positionals.field === undefined ? {} : { field: input.positionals.field }),
        ...(input.options['entry-mode'] === undefined ? {} : { entryMode: input.options['entry-mode'] as string }),
        ...(input.options['border-control'] === undefined ? {} : { borderControl: input.options['border-control'] as string }),
      });
    },
  },
  {
    service: 'sag', path: ['declaracion-jurada', 'preview'], summary: 'Validate a private declaration payload against live catalogs without submitting.',
    effect: 'read', auth: 'public', browser: 'none', profile: 'none',
    options: [{ name: 'input', kind: 'path', required: true, description: 'Private JSON (mode 0600) with traveler fields; choice fields use IDs from options.' }],
    output: { description: 'Normalized declaration preview (contains traveler data).' }, errors: ['INVALID_INPUT', 'PROVIDER_ERROR', 'CONTRACT_MISMATCH'],
    contractRef: 'services/sag/docs/contracts/declaration.md', discoverWith: ['portales sag declaracion-jurada options'],
    run: async (input, context) => {
      const payload = await readPrivateJson(input.options.input as string);
      context.stage('navigate');
      return previewSagDeclaration(payload);
    },
  },
  {
    service: 'sag', path: ['declaracion-jurada', 'download'], summary: 'Download and verify the PDF receipt of a completed declaration.',
    effect: 'read', auth: 'public', browser: 'none', profile: 'none',
    options: [
      { name: 'input', kind: 'path', required: true, description: 'Private JSON receipt (folio, declarationId, expected fields).' },
      { name: 'output', kind: 'path', required: true, description: 'New private PDF path outside any repository.' },
    ],
    output: { description: 'Artifact descriptor of the verified PDF.' }, errors: ['INVALID_INPUT', 'LOCAL_DEPENDENCY_MISSING', 'DOWNLOAD_INVALID', 'PROVIDER_ERROR', 'CONTRACT_MISMATCH'],
    contractRef: 'services/sag/docs/contracts/receipt.md',
    run: async (input, context) => {
      const receipt = await readPrivateJson(input.options.input as string);
      context.stage('download');
      const result = await downloadSagDeclaration(receipt, input.options.output as string);
      context.stage('verify');
      const artifact = await context.recordArtifact({
        identifiers: { folio: result.folio }, documentType: 'declaracion-jurada-receipt', extractedAt: new Date().toISOString(), coveredPeriod: null,
        byteCount: result.byteCount, mediaType: result.mediaType, sha256: result.sha256, validationChecks: ['private-permissions', 'signature', 'labeled-fields'], path: result.path,
      });
      return { ...artifact, folio: result.folio, verified: true };
    },
  },
];

export const sagService: ServiceSpec<CliDependencies> = {
  slug: 'sag', title: 'SAG', description: 'SAG entry declaration catalogs, preview, and receipt downloads (public, read-only).',
  docs: 'services/sag/docs/service.md', commands,
};
