import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PortalError } from '../../../bci-pyme/src/errors.js';
import { Rut } from '../../../sii/src/rut/rut.js';
import { readSagCatalogs } from '../portal/catalogs.js';
import { sagOptionGroups } from './options.js';

export const previewMetadata = {
  service: 'sag', operation: 'declaracion-jurada.preview', effect: 'read', auth: 'public',
} as const;

const choice = z.string().regex(/^\d+$/u);
const inputSchema = z.object({
  nationality: choice, authMethod: choice,
  firstName: z.string().trim().min(1), lastName: z.string().trim().min(1),
  email: z.email(), gender: choice, minorsLuggage: choice,
  travelDocument: choice, documentNumber: z.string().trim().min(1),
  originCountry: choice, entryMode: choice, borderControl: choice, transportType: choice,
  arrivalDate: z.iso.date(), sagProducts: choice,
}).strict();

/** Reviews the observed adult Chilean no-ClaveÚnica SAG flow, without creating a remote draft. */
export async function previewSagDeclaration(input: unknown) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PortalError('INVALID_INPUT', 'Provide the declaration fields documented by sag declaracion-jurada preview --help in a private JSON file.');
  }
  const intent = parsed.data;
  if (intent.nationality !== '1' || intent.authMethod !== '0' || intent.minorsLuggage !== '0'
    || intent.travelDocument !== '1') {
    throw new PortalError('INVALID_INPUT', 'The observed preview supports Chilean identity documents, without ClaveÚnica or minors luggage. Other branches require browser observation first.');
  }
  const rut = Rut.tryParse(intent.documentNumber);
  if (rut === null) throw new PortalError('INVALID_INPUT', 'The Chilean document number has an invalid check digit.');
  intent.documentNumber = rut.canonical;
  const catalogs = await readSagCatalogs();
  const groups = sagOptionGroups(catalogs);
  const selections = [
    ['nationality', intent.nationality], ['auth-method', intent.authMethod],
    ['gender', intent.gender], ['minors-luggage', intent.minorsLuggage],
    ['travel-document', intent.travelDocument], ['origin-country', intent.originCountry],
    ['entry-mode', intent.entryMode], ['border-control', intent.borderControl],
    ['transport-type', intent.transportType], ['arrival-date', intent.arrivalDate],
    ['sag-products', intent.sagProducts],
  ] as const;
  const labels: Record<string, string> = {};
  for (const [field, id] of selections) {
    const catalog = groups.find(group => group.field === field
      && (group.dependsOn.entryMode === undefined || group.dependsOn.entryMode === intent.entryMode)
      && (group.dependsOn.borderControl === undefined || group.dependsOn.borderControl === intent.borderControl));
    const selected = catalog?.options.find(option => option.id === id);
    if (selected === undefined) {
      const parent = field === 'border-control' ? ' --entry-mode <id>'
        : field === 'transport-type' || field === 'arrival-date' ? ' --border-control <id>' : '';
      throw new PortalError('INVALID_INPUT', `Invalid ${field}. Use sag declaracion-jurada options ${field}${parent}.`);
    }
    labels[field] = selected.label;
  }
  if (catalogs.borderControls.find(control => control.id === intent.borderControl)?.declarationType !== '1') {
    throw new PortalError('INVALID_INPUT', 'This control requires a different declaration branch. The observed preview currently supports SAG-only controls.');
  }
  return {
    intent, labels, remoteEffect: 'none' as const,
    confirmation: `sag-submit-${createHash('sha256').update(JSON.stringify(intent)).digest('hex')}`,
    submissionAvailable: false,
  };
}
