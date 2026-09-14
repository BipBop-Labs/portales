import { PortalError } from '../../../services/bci-pyme/src/errors.js';
import { listSagOptions } from '../../../services/sag/src/tasks/options.js';
import { previewSagDeclaration } from '../../../services/sag/src/tasks/preview.js';
import { downloadSagDeclaration } from '../../../services/sag/src/tasks/download.js';
import { readPrivateJson } from './private-input.js';

const usage = `portales sag declaracion-jurada options [field] [parent filter] [--human]
Fields: nationality, origin-country, gender, travel-document, entry-mode,
        border-control, transport-type, arrival-date, auth-method, minors-luggage, sag-products
border-control requires --entry-mode <id>; discover with options entry-mode.
transport-type requires --border-control <id>; discover with options border-control --entry-mode <id>.
arrival-date requires --border-control <id>; dates use America/Santiago.
No field returns all supported reference catalogs grouped by parent.
portales sag declaracion-jurada preview --input <private-json-file> [--human]
Preview fields: nationality, authMethod, firstName, lastName, email, gender,
minorsLuggage, travelDocument, documentNumber, originCountry, entryMode,
borderControl, transportType, arrivalDate (YYYY-MM-DD), sagProducts.
Choice fields use string IDs discovered with options. Preview prints sensitive traveler data.
Preview currently supports Chilean identity documents, without ClaveUnica or minors luggage, at SAG-only controls.
portales sag declaracion-jurada download --input <private-receipt-json> --output <new-private-pdf>
Receipt fields: folio (final folio), declarationId, fullName, documentNumber,
arrivalDate, borderControlLabel, sagProducts, minorsLuggage. Use the IDs returned by the completed operation.
Download supports the observed English PDF layout and requires pdftotext.
Public reads only. Automatic declaration creation and submission are not implemented.`;

export async function runSag(
  args: string[],
  stdout: (value: string) => void,
): Promise<number> {
  if (args.length === 1 && args[0] === '--help'
    || args.length === 2 && args[0] === 'declaracion-jurada' && args[1] === '--help'
    || args.length === 3 && args[0] === 'declaracion-jurada' && ['options', 'preview', 'download'].includes(args[1] ?? '') && args[2] === '--help') {
    stdout(`${usage}\n`);
    return 0;
  }
  if (args[0] === 'declaracion-jurada' && args[1] === 'download') {
    if (args.length !== 6 || args[2] !== '--input' || args[4] !== '--output'
      || args[3] === undefined || args[3].startsWith('--') || args[5] === undefined || args[5].startsWith('--')) {
      throw new PortalError('INVALID_INPUT', 'Use sag declaracion-jurada download --input <private-receipt-json> --output <new-private-pdf>.');
    }
    const result = await downloadSagDeclaration(await readPrivateJson(args[3]), args[5]);
    stdout(`${JSON.stringify(result)}\n`);
    return 0;
  }
  if (args[0] === 'declaracion-jurada' && args[1] === 'preview') {
    if (args[2] !== '--input' || args[3] === undefined || args[3].startsWith('--')
      || (args.length !== 4 && !(args.length === 5 && args[4] === '--human'))) {
      throw new PortalError('INVALID_INPUT', 'Use sag declaracion-jurada preview --input <private-json-file> [--human].');
    }
    const result = await previewSagDeclaration(await readPrivateJson(args[3]));
    stdout(`${JSON.stringify(result, null, args[4] === '--human' ? 2 : undefined)}\n`);
    return 0;
  }
  if (args[0] !== 'declaracion-jurada' || args[1] !== 'options') {
    throw new PortalError('INVALID_INPUT', 'Use sag declaracion-jurada --help. Supported actions: options, preview, download.');
  }
  const input: { field?: string; entryMode?: string; borderControl?: string } = {};
  let human = false;
  let index = 2;
  const field = args[index];
  if (field !== undefined && !field.startsWith('--')) { input.field = field; index++; }
  for (; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--human' && !human) { human = true; continue; }
    const key = arg === '--entry-mode' ? 'entryMode' : arg === '--border-control' ? 'borderControl' : undefined;
    const value = args[index + 1];
    if (key === undefined || input[key] !== undefined || value === undefined || value.startsWith('--')) {
      throw new PortalError('INVALID_INPUT', 'Unknown, repeated, or incomplete SAG argument. Use sag declaracion-jurada --help.');
    }
    input[key] = value;
    index++;
  }
  const result = await listSagOptions(input);
  stdout(`${JSON.stringify(result, null, human ? 2 : undefined)}\n`);
  return 0;
}
