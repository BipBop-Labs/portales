import { z } from 'zod';
import { PortalError } from '../../../bci-pyme/src/errors.js';
import { readSagCatalogs, type SagCatalogs } from '../portal/catalogs.js';

export const optionsMetadata = {
  service: 'sag', operation: 'declaracion-jurada.options', effect: 'read', auth: 'public',
} as const;

const fields = ['nationality', 'origin-country', 'gender', 'travel-document', 'entry-mode', 'border-control', 'transport-type', 'arrival-date', 'auth-method', 'minors-luggage', 'sag-products'] as const;
const inputSchema = z.object({
  field: z.enum(fields).optional(),
  entryMode: z.string().regex(/^\d+$/u).optional(),
  borderControl: z.string().regex(/^\d+$/u).optional(),
}).strict();

interface OptionGroup {
  field: typeof fields[number];
  dependsOn: { entryMode?: string; borderControl?: string };
  options: { id: string; label: string; aliases: string[] }[];
}

function group(field: OptionGroup['field'], values: { id: string; label: string }[], dependsOn: OptionGroup['dependsOn'] = {}): OptionGroup {
  return { field, dependsOn, options: values.map(({ id, label }) => ({ id, label, aliases: [] })) };
}

/** Returns complete reference catalogs, retaining the parents of dependent choices. Never creates a declaration. */
export async function listSagOptions(input: unknown) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new PortalError('INVALID_INPUT', `Use sag declaracion-jurada options [${fields.join('|')}].`);
  const { field, entryMode, borderControl } = parsed.data;
  if ((field === 'border-control') !== (entryMode !== undefined)
    || (field === 'transport-type' || field === 'arrival-date') !== (borderControl !== undefined)) {
    throw new PortalError('INVALID_INPUT', 'border-control requires only --entry-mode (discover with options entry-mode); transport-type and arrival-date require only --border-control (discover with options border-control --entry-mode <id>).');
  }
  const catalogs = await readSagCatalogs();
  const activeControls = catalogs.borderControls.filter(item => item.active);
  if (entryMode !== undefined && !catalogs.entryModes.some(item => item.id === entryMode)) {
    throw new PortalError('INVALID_INPUT', 'Unknown entry mode. Use sag declaracion-jurada options entry-mode.');
  }
  if (borderControl !== undefined && !activeControls.some(item => item.id === borderControl)) {
    throw new PortalError('INVALID_INPUT', 'Unknown active border control. Use sag declaracion-jurada options border-control --entry-mode <id>.');
  }
  const groups = sagOptionGroups(catalogs);
  if (field === undefined) return { catalogs: groups };
  const selected = groups.find(item => item.field === field
    && item.dependsOn.entryMode === entryMode && item.dependsOn.borderControl === borderControl);
  if (!selected) throw new PortalError('PORTAL_CHANGED', 'SAG did not provide the selected catalog. Inspect the options contract.');
  return selected;
}

/** Same observed selector rules serve discovery and preparation, including the local Chilean calendar day. */
export function sagOptionGroups(catalogs: SagCatalogs, now = new Date()): OptionGroup[] {
  const activeControls = catalogs.borderControls.filter(item => item.active);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const yesNo = [{ id: '1', label: 'Sí' }, { id: '0', label: 'No' }];
  return [
    group('nationality', catalogs.countries),
    // The origin picker excludes Chile (observed portal country ID), unlike nationality.
    group('origin-country', catalogs.countries.filter(country => country.id !== '1')),
    group('gender', catalogs.genders),
    group('travel-document', catalogs.documents),
    group('entry-mode', catalogs.entryModes),
    ...catalogs.entryModes.map(mode => group('border-control',
      activeControls.filter(item => item.entryMode === mode.id), { entryMode: mode.id })),
    ...activeControls.map(control => {
      const ids = new Set(catalogs.transportLinks.filter(item => item.borderControl === control.id).map(item => item.transportType));
      return group('transport-type', catalogs.transports.filter(item => ids.has(item.id)), { borderControl: control.id });
    }),
    ...activeControls.map(control => group('arrival-date', Array.from({ length: control.advanceDays }, (_, offset) => {
      const day = new Date(`${today}T12:00:00Z`);
      day.setUTCDate(day.getUTCDate() + offset);
      const id = day.toISOString().slice(0, 10);
      return { id, label: id };
    }), { borderControl: control.id })),
    group('auth-method', [{ id: '0', label: 'Sin ClaveÚnica' }, { id: '1', label: 'ClaveÚnica' }]),
    group('minors-luggage', yesNo),
    group('sag-products', yesNo),
  ];
}
