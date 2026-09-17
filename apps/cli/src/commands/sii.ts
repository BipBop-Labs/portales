import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PortalError, invalidInput } from '../../../../packages/runtime/src/errors.js';
import { publishArtifactFile, resolveDestination } from '../../../../packages/runtime/src/destinations.js';
import { validateDownloadedFile } from '../../../../packages/runtime/src/downloads.js';
import { requireConfirm, type ArgumentSpec, type CommandSpec, type ParsedInput, type RunContext, type ServiceSpec } from '../../../../packages/runtime/src/registry.js';
import type { CliDependencies } from '../dependencies.js';
import { SiiLoginBreaker } from '../../../../services/sii/src/auth/login-breaker.js';
import { readOperateState } from '../../../../services/sii/src/identity/index.js';
import { SII_DOCS, guardSii } from '../../../../services/sii/src/portales-errors.js';
import { createPortalesSiiRuntime, siiDocumentsDir } from '../../../../services/sii/src/runtime.js';
import type { Runtime } from '../../../../services/sii/src/seams/index.js';
import { authStatus, logout } from '../../../../services/sii/src/tasks/auth.js';
import { rcvList, rcvListAll, rcvSummary } from '../../../../services/sii/src/tasks/rcv.js';
import { BTE_COMUNAS, bteEmit, bteEmitPreview, bteList, type BteEmitArgs } from '../../../../services/sii/src/tasks/bte.js';
import {
  MAX_ITEMS, dteAuthorized, dteBorradorDelete, dteBorradorList, dteBorradorSave, dteEmitidos, dteEmpresas, dtePdf, dtePreviewPdf, dteRecibidoPdf, dteRecibidos,
  type DteBorradorArgs, type DteItem, type FormaPago,
} from '../../../../services/sii/src/tasks/dte.js';

type Spec = CommandSpec<CliDependencies>;
type Context = RunContext<CliDependencies>;

const sessionErrors = ['NOT_AUTHENTICATED', 'SESSION_EXPIRED', 'RATE_LIMITED', 'PROVIDER_ERROR', 'CONTRACT_MISMATCH', 'BROWSER_LAUNCH_FAILED', 'RUN_LOCKED'] as const;
const EMPRESAS = 'portales sii dte empresas --profile <profile>';
const empresaOption: ArgumentSpec = { name: 'empresa', kind: 'string', required: true, description: 'Empresa RUT authorized for the MIPYME portal.', discoverWith: EMPRESAS };
const scopeOption: ArgumentSpec = { name: 'empresa', kind: 'string', description: 'Operate as this represented empresa RUT (must be in the operable set).', discoverWith: 'portales sii auth status --profile <profile>' };
const periodoPositional: ArgumentSpec = { name: 'periodo', kind: 'period', required: true, description: 'Tax period YYYY-MM.' };
const ventaOption: ArgumentSpec = { name: 'venta', kind: 'boolean', description: 'Sales register instead of purchases.' };
const outputOptions: ArgumentSpec[] = [
  { name: 'output', kind: 'path', description: 'Existing private directory (0700, outside any repository) for the PDF.' },
  { name: 'destination', kind: 'string', description: 'Alias from the private destination configuration (~/.config/portales/destinations.json).' },
];

function runtimeFor(context: Context, profile: string): Runtime {
  return context.deps.createSiiRuntime === undefined ? createPortalesSiiRuntime(profile) : context.deps.createSiiRuntime(profile);
}

function profileOf(input: ParsedInput): string {
  return input.profile ?? 'default';
}

function str(input: ParsedInput, name: string): string | undefined {
  const value = input.options[name];
  return typeof value === 'string' ? value : undefined;
}

function num(input: ParsedInput, name: string): number | undefined {
  const value = input.options[name];
  return typeof value === 'number' ? value : undefined;
}

function flag(input: ParsedInput, name: string): boolean {
  return input.options[name] === true;
}

/** Entity scope for body-RUT operations: `--empresa` selects a represented entity from the operable set. */
function scope(input: ParsedInput): { rut?: string } {
  const empresa = str(input, 'empresa');
  return empresa === undefined ? {} : { rut: empresa };
}

function withScope<T>(context: Context, profile: string, section: string, work: (runtime: Runtime) => Promise<T>, discoverWith?: string): Promise<T> {
  context.stage('session-check');
  const runtime = runtimeFor(context, profile);
  return guardSii(() => { context.stage('navigate'); return work(runtime); }, { profile, contractRef: `${SII_DOCS}#${section}`, ...(discoverWith === undefined ? {} : { discoverWith: discoverWith.replaceAll('<profile>', profile) }) });
}

/** Principal-only operations report their scope and reject a representing operate pointer locally. */
async function principalScope(runtime: Runtime, profile: string) {
  const state = await readOperateState(runtime.store);
  if (state !== null && state.operatingRut !== state.selfRut) {
    throw invalidInput('This operation is session-keyed: SII authorizes it by the logged-in principal, not by the operated empresa.', [
      { field: 'scope', expected: 'the authenticated principal (supportedScopes: principal)', received: 'representing operate pointer' },
    ], { nextAction: 'Log in as the empresa itself to read its boletas.', nextCommand: `portales sii auth logout --profile ${profile}` });
  }
  return { supportedScopes: ['principal'] as const, principal: state === null ? null : { rut: state.selfRut, accountType: state.accountType } };
}

async function privateJson(path: string): Promise<unknown> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await file.stat();
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
      throw invalidInput('The invoice input must be a private regular file (mode 0600).', [{ field: '<invoice>', expected: 'regular file without group/other permissions' }]);
    }
    return JSON.parse(await file.readFile('utf8')) as unknown;
  } catch (error: unknown) {
    if (error instanceof PortalError) throw error;
    throw invalidInput('The invoice input could not be read as JSON.', [{ field: '<invoice>', expected: 'valid JSON' }]);
  } finally {
    await file?.close();
  }
}

interface FacturaJson {
  empresa?: string; tipo_dte?: number; fecha_emision?: string; ciudad_emisor?: string; forma_pago?: string; borrador_id?: string;
  receptor?: Record<string, unknown>; items?: Record<string, unknown>[];
}

function text(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') throw invalidInput(`Missing ${key} in invoice JSON.`, [{ field: key, expected: 'non-empty string' }]);
  return value;
}

function number(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number') throw invalidInput(`Missing ${key} in invoice JSON.`, [{ field: key, expected: 'number' }]);
  return value;
}

function facturaArgs(document: FacturaJson, input: ParsedInput): DteBorradorArgs {
  const receptor = document.receptor ?? {};
  const rawItems = document.items ?? [];
  if (rawItems.length === 0 || rawItems.length > MAX_ITEMS) {
    throw invalidInput(`Invoice JSON needs 1 to ${String(MAX_ITEMS)} items.`, [{ field: 'items', expected: `1 to ${String(MAX_ITEMS)} entries` }]);
  }
  const forma = (document.forma_pago ?? 'credito').toLowerCase();
  const formas: Record<string, FormaPago> = { contado: 'contado', credito: 'credito', 'crédito': 'credito', sin_costo: 'sin_costo' };
  const formaPago = formas[forma];
  if (!formaPago) throw invalidInput('forma_pago must be contado, credito, or sin_costo.', [{ field: 'forma_pago', expected: 'contado | credito | sin_costo', received: forma }]);
  const empresa = str(input, 'empresa') ?? document.empresa;
  const ciudad = str(input, 'ciudad') ?? document.ciudad_emisor;
  const fecha = str(input, 'fecha') ?? document.fecha_emision;
  const borrador = str(input, 'borrador') ?? document.borrador_id;
  if (!empresa || !ciudad) throw invalidInput('empresa and ciudad_emisor are required.', [{ field: '--empresa', expected: 'authorized empresa RUT', discoverWith: EMPRESAS }, { field: 'ciudad_emisor', expected: 'non-empty string' }]);
  const items: DteItem[] = rawItems.map((item) => ({
    nombre: text(item, 'nombre'),
    ...(typeof item.descripcion === 'string' ? { descripcion: item.descripcion } : {}),
    cantidad: number(item, 'cantidad'),
    ...(typeof item.unidad === 'string' ? { unidad: item.unidad } : {}),
    precioUnitario: number(item, 'precio_unitario'),
    ...(typeof item.descuento_pct === 'number' ? { descuentoPct: item.descuento_pct } : {}),
  }));
  return {
    empresa,
    ...(document.tipo_dte !== undefined ? { tipoDte: document.tipo_dte } : {}),
    ...(fecha ? { fechaEmision: fecha } : {}),
    ciudadEmisor: ciudad,
    receptor: {
      rut: text(receptor, 'rut'), razonSocial: text(receptor, 'razon_social'), direccion: text(receptor, 'direccion'),
      comuna: text(receptor, 'comuna'), ciudad: text(receptor, 'ciudad'), giro: text(receptor, 'giro'),
      ...(typeof receptor.contacto === 'string' ? { contacto: receptor.contacto } : {}),
    },
    items, formaPago,
    ...(borrador ? { borradorId: borrador } : {}),
  };
}

function bteArgs(input: ParsedInput): BteEmitArgs {
  const raw = input.options.linea;
  const lineas = (Array.isArray(raw) ? raw : []).map((value) => {
    const i = value.indexOf(':');
    const monto = Number(value.slice(0, i));
    const glosa = value.slice(i + 1).trim();
    if (i < 0 || !Number.isInteger(monto) || monto <= 0 || glosa === '') {
      throw invalidInput('--linea must be "<monto>:<glosa>".', [{ field: '--linea', expected: '"<monto>:<glosa>" with a positive integer monto' }]);
    }
    return { glosa, monto };
  });
  const retiene = (str(input, 'retiene') ?? 'receptor').toUpperCase() as 'RECEPTOR' | 'EMISOR';
  const fecha = str(input, 'fecha');
  const match = fecha === undefined ? undefined : /^(\d{4})-(\d{2})-(\d{2})$/u.exec(fecha);
  const enviar = str(input, 'enviar');
  return {
    receptor: str(input, 'receptor') ?? '', receptorNombre: str(input, 'nombre') ?? '', receptorDomicilio: str(input, 'domicilio') ?? '',
    region: num(input, 'region') ?? 0, comuna: num(input, 'comuna') ?? 0, lineas, retiene,
    ...(match ? { fecha: { anio: Number(match[1]), mes: Number(match[2]), dia: Number(match[3]) } } : {}),
    ...(flag(input, 'sin-detalle') ? { mostrarDetalle: false } : {}),
    ...(enviar ? { enviarA: enviar } : {}),
    ...(flag(input, 'sin-copia') ? { copiaEmisor: false } : {}),
  };
}

const emitidosFilters: ArgumentSpec[] = [
  { name: 'tipo-doc', kind: 'integer', description: 'DTE type filter.' },
  { name: 'folio', kind: 'integer', description: 'Folio filter.' },
  { name: 'estado', kind: 'enum', values: ['emitido', 'preview'], description: 'State filter.' },
  { name: 'receptor', kind: 'string', description: 'Receptor RUT filter.' },
  { name: 'desde', kind: 'date', description: 'From date (YYYY-MM-DD).' },
  { name: 'hasta', kind: 'date', description: 'To date (YYYY-MM-DD).' },
  { name: 'pagina', kind: 'integer', description: 'Page number.' },
];

function emitidosArgs(input: ParsedInput) {
  const tipoDoc = num(input, 'tipo-doc'); const folio = num(input, 'folio'); const estado = str(input, 'estado') as 'emitido' | 'preview' | undefined;
  const receptor = str(input, 'receptor'); const desde = str(input, 'desde'); const hasta = str(input, 'hasta'); const pagina = num(input, 'pagina');
  return {
    empresa: str(input, 'empresa') ?? '',
    ...(tipoDoc !== undefined ? { tipoDoc } : {}), ...(folio !== undefined ? { folio } : {}), ...(estado !== undefined ? { estado } : {}),
    ...(receptor ? { receptor } : {}), ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}), ...(pagina !== undefined ? { pagina } : {}),
  };
}

/** Downloads one issued DTE PDF, validates it, records the artifact, and places it per destination policy. */
async function downloadIssued(input: ParsedInput, context: Context, folio: number) {
  const profile = profileOf(input);
  const empresa = str(input, 'empresa') ?? '';
  const output = str(input, 'output'); const destination = str(input, 'destination');
  const staging = siiDocumentsDir(profile);
  const doc = await withScope(context, profile, 'electronic-invoicing', (runtime) => dtePdf(runtime, { empresa, folio, directorio: staging }), 'portales sii dte documentos list --empresa <rut> --direction issued --profile <profile>');
  context.stage('download');
  const validated = await validateDownloadedFile(doc.path, 'application/pdf');
  context.stage('verify');
  const target = await resolveDestination({ service: 'sii', profile, documentType: 'dte-pdf', identifiers: { empresa: doc.empresa.rut, folio: String(folio) }, ...(output === undefined ? {} : { output }), ...(destination === undefined ? {} : { destination }) });
  const finalPath = target.directory === staging ? doc.path : await publishArtifactFile(doc.path, target.directory, basename(doc.path));
  const artifact = await context.recordArtifact({
    identifiers: { empresa: doc.empresa.rut, folio: String(folio) }, documentType: 'dte-pdf', extractedAt: new Date().toISOString(), coveredPeriod: null,
    byteCount: validated.byteCount, mediaType: validated.mediaType, sha256: validated.sha256, validationChecks: ['private-permissions', 'signature'], path: finalPath,
  });
  return { ...artifact, destination: target.source, documento: doc.documento, empresa: doc.empresa };
}

const RECEIVED_LIST = 'portales sii dte documentos list --empresa <rut> --direction received --profile <profile>';

/** Text-level checks on a received PDF when pdftotext is available: folio and both RUTs (emisor, empresa) must appear. */
async function receivedTextChecks(path: string, folio: number, ruts: string[]): Promise<string[]> {
  let text: string;
  try {
    ({ stdout: text } = await promisify(execFile)('pdftotext', ['-layout', path, '-'], { timeout: 15_000, maxBuffer: 4_000_000 }));
  } catch {
    return [];
  }
  const normalized = text.replace(/\./gu, '').toUpperCase();
  const checks: string[] = [];
  if (new RegExp(`(?:N[°º]|FOLIO)\\s*${String(folio)}\\b`, 'u').test(text)) checks.push('folio-in-text');
  if (ruts.every((rut) => normalized.includes(rut.replace(/\./gu, '').toUpperCase()))) checks.push('ruts-in-text');
  if (checks.length < 2) {
    throw new PortalError('DOWNLOAD_INVALID', `The received PDF text does not carry the expected folio and RUTs (${checks.join(', ') || 'none'} matched).`, {
      recovery: { stage: 'verify', lastCompletedStage: 'download', contractRef: `${SII_DOCS}#dte-documents`, nextAction: 'Do not trust the file. Compare the listing row with the PDF; if the layout changed, observe and update the contract.' },
    });
  }
  return checks;
}

/** Downloads one received DTE PDF, validates signature and text, records the artifact, and places it per destination policy. */
async function downloadReceived(input: ParsedInput, context: Context) {
  const profile = profileOf(input);
  const empresa = str(input, 'empresa') ?? '';
  const folio = num(input, 'folio') ?? 0;
  const emisor = str(input, 'emisor');
  const output = str(input, 'output'); const destination = str(input, 'destination');
  const staging = siiDocumentsDir(profile);
  const doc = await withScope(context, profile, 'dte-documents', (runtime) => dteRecibidoPdf(runtime, { empresa, folio, ...(emisor === undefined ? {} : { emisor }), directorio: staging }), RECEIVED_LIST);
  context.stage('download');
  const validated = await validateDownloadedFile(doc.path, 'application/pdf');
  context.stage('verify');
  const emisorRut = doc.documento.emisorRut ?? '';
  const textChecks = await receivedTextChecks(doc.path, folio, [emisorRut, doc.empresa.rut]);
  const identifiers = { empresa: doc.empresa.rut, emisor: emisorRut.replace(/[^0-9kK-]/gu, ''), folio: String(folio) };
  const target = await resolveDestination({ service: 'sii', profile, documentType: 'dte-received-pdf', identifiers, ...(output === undefined ? {} : { output }), ...(destination === undefined ? {} : { destination }) });
  const finalPath = target.directory === staging ? doc.path : await publishArtifactFile(doc.path, target.directory, basename(doc.path));
  const artifact = await context.recordArtifact({
    identifiers, documentType: 'dte-received-pdf', extractedAt: new Date().toISOString(), coveredPeriod: null,
    byteCount: validated.byteCount, mediaType: validated.mediaType, sha256: validated.sha256, validationChecks: ['private-permissions', 'signature', ...textChecks], path: finalPath,
  });
  return { ...artifact, destination: target.source, documento: doc.documento, empresa: doc.empresa };
}

function auth(path: string[], summary: string, extra: Partial<Spec>, run: Spec['run']): Spec {
  return { service: 'sii', path, summary, effect: 'read', auth: 'public', browser: 'none', profile: 'optional', output: { description: '' }, errors: [], contractRef: `${SII_DOCS}#authentication`, ...extra, run };
}

const commands: Spec[] = [
  auth(['auth', 'setup'], 'Store SII credentials (RUT and Clave Tributaria) in the OS keyring through hidden prompts.', { effect: 'write', auth: 'interactive', profile: 'required', output: { description: '{ configured: true, profile }' }, errors: ['INVALID_INPUT', 'KEYRING_UNAVAILABLE', 'CREDENTIALS_INVALID'] }, (input, context) => {
    if (context.deps.setupSii === undefined) throw new PortalError('KEYRING_UNAVAILABLE', 'Interactive credential setup is unavailable.');
    return context.deps.setupSii({ profile: input.profile as string });
  }),
  auth(['auth', 'login'], 'Log in to SII once with the keyring credential bundle for this profile.', { browser: 'headless', profile: 'required', output: { description: '{ authenticated, reason, rut }' }, errors: ['CREDENTIALS_NOT_CONFIGURED', 'CREDENTIALS_INVALID', 'KEYRING_LOCKED', 'KEYRING_UNAVAILABLE', 'LOGIN_FAILED', 'ACCOUNT_BLOCKED', 'RATE_LIMITED', 'BROWSER_LAUNCH_FAILED', 'RUN_LOCKED'] }, (input, context) => {
    if (context.deps.loginSii === undefined) throw new PortalError('INTERNAL', 'The SII login dependency is unavailable.');
    context.stage('navigate');
    return context.deps.loginSii({ profile: input.profile as string });
  }),
  auth(['auth', 'status'], 'Local session presence, expiry, principal, and breaker state. Never contacts SII or submits credentials.', { output: { description: '{ authenticated, rut, sessionSource, www2, lastAuthenticatedStage, breaker, newLoginPermitted }' } }, async (input, context) => {
    const profile = profileOf(input);
    const runtime = runtimeFor(context, profile);
    const status = await authStatus(runtime);
    const breaker = await new SiiLoginBreaker(context.deps.stateRoot).status(profile);
    return { ...status, expiresAt: status.www2.expiresAt, lastAuthenticatedStage: status.authenticated ? 'session-persisted' : null, breaker: { tripped: breaker.tripped, trippedAt: breaker.trippedAt, reason: breaker.reason }, newLoginPermitted: breaker.newLoginPermitted };
  }),
  auth(['auth', 'logout'], 'Close the SII session remotely when possible and delete local session material.', { browser: 'headless', output: { description: '{ loggedOut, serverClosed, www2Closed }' }, errors: ['BROWSER_LAUNCH_FAILED', 'RUN_LOCKED'] }, (input, context) => withScope(context, profileOf(input), 'authentication', (runtime) => logout(runtime))),
  auth(['auth', 'breaker', 'status'], 'Report the SII login breaker for this profile without touching credentials.', { output: { description: '{ tripped, trippedAt, reason, newLoginPermitted, path }' } }, async (input, context) => new SiiLoginBreaker(context.deps.stateRoot).status(profileOf(input))),

  ...([['summary', 'Monthly RCV totals per document type.'], ['list', 'RCV documents of one type for a period.'], ['all', 'Every RCV document for a period across all types.']] as const).map(([action, summary]): Spec => ({
    service: 'sii', path: ['rcv', action], summary, effect: 'read', auth: 'session', browser: 'headless', profile: 'optional',
    positionals: [periodoPositional],
    options: [ventaOption, scopeOption, ...(action === 'list' ? [{ name: 'tipo', kind: 'string', required: true, description: 'Document type code.', discoverWith: 'portales sii rcv summary <periodo> --profile <profile>' } as ArgumentSpec] : [])],
    output: { description: 'RCV result for the selected scope.' }, errors: ['INVALID_INPUT', ...sessionErrors], contractRef: `${SII_DOCS}#rcv-purchases-and-sales`,
    run: (input, context) => {
      const periodo = input.positionals.periodo as string;
      const side = flag(input, 'venta') ? 'VENTA' : 'COMPRA';
      const rut = scope(input);
      return withScope<unknown>(context, profileOf(input), 'rcv-purchases-and-sales', (runtime) => {
        if (action === 'summary') return rcvSummary(runtime, { periodo, side, ...rut });
        if (action === 'all') return rcvListAll(runtime, { periodo, side, ...rut });
        return rcvList(runtime, { periodo, side, codigoTipoDoc: str(input, 'tipo') ?? '', ...rut });
      }, 'portales sii auth status --profile <profile>');
    },
  })),

  {
    service: 'sii', path: ['bte', 'list'], summary: 'Boletas de honorarios for one month. Session-keyed: the authenticated principal only.',
    effect: 'read', auth: 'session', browser: 'headless', profile: 'optional', positionals: [periodoPositional],
    options: [{ name: 'recibidas', kind: 'boolean', description: 'Received instead of issued.' }],
    output: { description: 'BteMensual + supportedScopes + principal' }, errors: ['INVALID_INPUT', ...sessionErrors], contractRef: `${SII_DOCS}#boletas-de-honorarios-btebhe`,
    run: (input, context) => withScope(context, profileOf(input), 'boletas-de-honorarios-btebhe', async (runtime) => {
      const meta = await principalScope(runtime, profileOf(input));
      return { ...await bteList(runtime, { periodo: input.positionals.periodo as string, side: flag(input, 'recibidas') ? 'RECIBIDAS' : 'EMITIDAS' }), ...meta };
    }),
  },
  {
    service: 'sii', path: ['bte', 'comunas'], summary: 'Comuna catalog for BTE emission (local, no portal contact).',
    effect: 'read', auth: 'public', browser: 'none', profile: 'none', options: [{ name: 'region', kind: 'integer', description: 'Region number.' }],
    output: { description: '{ [region]: { [comuna]: label } }' }, errors: ['INVALID_INPUT'], contractRef: `${SII_DOCS}#boletas-de-honorarios-btebhe`,
    run: (input) => { const region = num(input, 'region'); return Promise.resolve(region === undefined ? BTE_COMUNAS : (BTE_COMUNAS[region] ?? {})); },
  },
  {
    service: 'sii', path: ['bte', 'emit'], summary: 'Preview (default) or legally issue one boleta de honorarios; --confirm must equal the gross total.',
    effect: 'write', auth: 'session', browser: 'headless', profile: 'optional',
    options: [
      { name: 'receptor', kind: 'string', required: true, description: 'Receptor RUT.' }, { name: 'nombre', kind: 'string', required: true, description: 'Receptor name.' },
      { name: 'domicilio', kind: 'string', required: true, description: 'Receptor address.' },
      { name: 'region', kind: 'integer', required: true, description: 'Region number.', discoverWith: 'portales sii bte comunas' },
      { name: 'comuna', kind: 'integer', required: true, description: 'Comuna code.', discoverWith: 'portales sii bte comunas --region <region>' },
      { name: 'linea', kind: 'string', required: true, repeatable: true, description: '"<monto>:<glosa>" line (1 to 4).' },
      { name: 'retiene', kind: 'enum', values: ['receptor', 'emisor'], description: 'Who retains (default receptor).' },
      { name: 'fecha', kind: 'date', description: 'Boleta date (default today, within ±3 months).' },
      { name: 'sin-detalle', kind: 'boolean', description: 'Hide line detail.' }, { name: 'enviar', kind: 'string', description: 'Email destination for the PDF (emit only).' },
      { name: 'sin-copia', kind: 'boolean', description: 'No copy to the emisor.' },
    ],
    confirm: { description: 'Gross total of all lines; omit to preview.' },
    output: { description: '{ emitida, ...preview or issued boleta, supportedScopes, principal }' }, errors: ['INVALID_INPUT', 'CONFIRMATION_REQUIRED', ...sessionErrors], contractRef: `${SII_DOCS}#boletas-de-honorarios-btebhe`,
    run: (input, context) => withScope(context, profileOf(input), 'boletas-de-honorarios-btebhe', async (runtime) => {
      const args = bteArgs(input);
      const meta = await principalScope(runtime, profileOf(input));
      if (input.options.confirm === undefined) return { emitida: false, ...await bteEmitPreview(runtime, args), ...meta };
      const total = args.lineas.reduce((sum, linea) => sum + linea.monto, 0);
      requireConfirm(input, String(total), `the gross total (${String(total)})`);
      context.stage('verify');
      return { emitida: true, ...await bteEmit(runtime, args), ...meta };
    }),
  },

  {
    service: 'sii', path: ['dte', 'authorized'], summary: 'Public consulta: whether a RUT is authorized to emit DTE (no login).',
    effect: 'read', auth: 'public', browser: 'none', profile: 'optional', positionals: [{ name: 'rut', kind: 'string', required: true, description: 'Any RUT.' }],
    output: { description: 'DteAutorizados' }, errors: ['INVALID_INPUT', 'PROVIDER_ERROR', 'CONTRACT_MISMATCH'], contractRef: `${SII_DOCS}#electronic-invoicing`,
    run: (input, context) => withScope(context, profileOf(input), 'electronic-invoicing', (runtime) => dteAuthorized(runtime, { rut: input.positionals.rut as string })),
  },
  {
    service: 'sii', path: ['dte', 'empresas'], summary: 'Empresas that authorize this user in the MIPYME portal.',
    effect: 'read', auth: 'session', browser: 'headless', profile: 'optional', options: [{ name: 'tipo', kind: 'integer', description: 'DTE type (default 33).' }],
    output: { description: '[{ rut, nombre }]' }, errors: ['INVALID_INPUT', ...sessionErrors], contractRef: `${SII_DOCS}#electronic-invoicing`,
    run: (input, context) => withScope(context, profileOf(input), 'electronic-invoicing', (runtime) => { const tipoDte = num(input, 'tipo'); return dteEmpresas(runtime, tipoDte === undefined ? {} : { tipoDte }); }),
  },
  {
    service: 'sii', path: ['dte', 'documentos', 'list'], summary: 'List DTE documents of one empresa in the MIPYME portal: --direction issued (emitidos) or received (recibidos).',
    description: 'Received rows carry codigo, emisorRut, folio, fecha, monto and estado; use --emisor to narrow a folio shared by several emisores. Only page 1 per filter is read (portal paging is reCAPTCHA-gated); narrow with --folio, --emisor, --desde/--hasta.',
    effect: 'read', auth: 'session', browser: 'headless', profile: 'optional',
    options: [empresaOption, { name: 'direction', kind: 'enum', values: ['issued', 'received'], required: true, description: 'Document direction.' }, { name: 'emisor', kind: 'string', description: 'Emisor RUT filter (received only).' }, ...emitidosFilters],
    output: { description: '{ direction, source, empresa, documentos }' }, errors: ['INVALID_INPUT', ...sessionErrors], contractRef: `${SII_DOCS}#dte-documents`, discoverWith: [EMPRESAS],
    run: (input, context) => {
      if (str(input, 'direction') === 'received') {
        const emisor = str(input, 'emisor');
        const args = emitidosArgs(input);
        if (args.estado !== undefined || args.receptor !== undefined) throw invalidInput('--estado and --receptor apply to issued documents only.', [{ field: '--estado/--receptor', expected: 'absent for --direction received' }]);
        const common = { empresa: args.empresa, ...(args.tipoDoc === undefined ? {} : { tipoDoc: args.tipoDoc }), ...(args.folio === undefined ? {} : { folio: args.folio }), ...(args.desde === undefined ? {} : { desde: args.desde }), ...(args.hasta === undefined ? {} : { hasta: args.hasta }), ...(args.pagina === undefined ? {} : { pagina: args.pagina }) };
        return withScope(context, profileOf(input), 'dte-documents', async (runtime) => ({ direction: 'received', source: 'mipyme-recibidos', ...await dteRecibidos(runtime, { ...common, ...(emisor === undefined ? {} : { emisor }) }) }), EMPRESAS);
      }
      return withScope(context, profileOf(input), 'dte-documents', async (runtime) => ({ direction: 'issued', source: 'mipyme-emitidos', ...await dteEmitidos(runtime, emitidosArgs(input)) }), EMPRESAS);
    },
  },
  {
    service: 'sii', path: ['dte', 'documentos', 'download'], summary: 'Download one DTE PDF by folio, issued or received, and return its artifact descriptor.',
    effect: 'read', auth: 'session', browser: 'headless', profile: 'optional',
    options: [empresaOption, { name: 'direction', kind: 'enum', values: ['issued', 'received'], required: true, description: 'Document direction.' }, { name: 'folio', kind: 'integer', required: true, description: 'Folio.', discoverWith: 'portales sii dte documentos list --empresa <rut> --direction <direction> --profile <profile>' }, { name: 'emisor', kind: 'string', description: 'Emisor RUT (received only; required when several emisores share the folio).', discoverWith: RECEIVED_LIST }, ...outputOptions],
    output: { description: 'Artifact descriptor (artifactId, sha256, byteCount, mediaType, path, identifiers, documentType, extractedAt, coveredPeriod, validationChecks) + documento + empresa' },
    errors: ['INVALID_INPUT', 'DOWNLOAD_INVALID', ...sessionErrors], contractRef: `${SII_DOCS}#dte-documents`, discoverWith: [EMPRESAS, RECEIVED_LIST],
    run: (input, context) => {
      if (str(input, 'direction') === 'received') return downloadReceived(input, context);
      if (str(input, 'emisor') !== undefined) throw invalidInput('--emisor applies to received documents only.', [{ field: '--emisor', expected: 'absent for --direction issued' }]);
      return downloadIssued(input, context, num(input, 'folio') ?? 0);
    },
  },
  {
    service: 'sii', path: ['dte', 'emitidos'], summary: 'Issued DTE listing for one empresa (alias of dte documentos list --direction issued).',
    effect: 'read', auth: 'session', browser: 'headless', profile: 'optional', options: [empresaOption, ...emitidosFilters],
    output: { description: '{ empresa, documentos }' }, errors: ['INVALID_INPUT', ...sessionErrors], contractRef: `${SII_DOCS}#electronic-invoicing`, discoverWith: [EMPRESAS],
    run: (input, context) => withScope(context, profileOf(input), 'electronic-invoicing', (runtime) => dteEmitidos(runtime, emitidosArgs(input)), EMPRESAS),
  },
  {
    service: 'sii', path: ['dte', 'pdf'], summary: 'Download an issued DTE as PDF (alias of dte documentos download --direction issued).',
    effect: 'read', auth: 'session', browser: 'headless', profile: 'optional',
    positionals: [{ name: 'folio', kind: 'integer', required: true, description: 'Folio.', discoverWith: 'portales sii dte emitidos --empresa <rut> --profile <profile>' }],
    options: [empresaOption, ...outputOptions],
    output: { description: 'Artifact descriptor + documento' }, errors: ['INVALID_INPUT', 'DOWNLOAD_INVALID', ...sessionErrors], contractRef: `${SII_DOCS}#electronic-invoicing`, discoverWith: [EMPRESAS],
    run: (input, context) => downloadIssued(input, context, Number(input.positionals.folio)),
  },
  {
    service: 'sii', path: ['dte', 'preview'], summary: 'Render a draft factura JSON as a preview PDF (stamped NOT VALID) without saving a draft.',
    effect: 'read', auth: 'session', browser: 'headless', profile: 'optional',
    positionals: [{ name: 'invoice', kind: 'path', required: true, description: 'Private invoice JSON (mode 0600).' }],
    options: [{ ...empresaOption, required: false, description: 'Empresa RUT override for the JSON.' }, { name: 'ciudad', kind: 'string', description: 'Emitter city override.' }, { name: 'fecha', kind: 'date', description: 'Emission date override.' }, { name: 'borrador', kind: 'string', description: 'Existing draft id to re-preview.' }, { name: 'out', kind: 'path', description: 'Private output directory (default: profile documents directory).' }],
    output: { description: 'Preview PDF descriptor' }, errors: ['INVALID_INPUT', ...sessionErrors], contractRef: `${SII_DOCS}#electronic-invoicing`, discoverWith: [EMPRESAS],
    run: async (input, context) => {
      const args = facturaArgs(await privateJson(input.positionals.invoice as string) as FacturaJson, input);
      const directorio = str(input, 'out') ?? siiDocumentsDir(profileOf(input));
      return withScope(context, profileOf(input), 'electronic-invoicing', (runtime) => dtePreviewPdf(runtime, { ...args, directorio }), EMPRESAS);
    },
  },
  {
    service: 'sii', path: ['dte', 'borrador', 'list'], summary: 'List draft facturas for one empresa.',
    effect: 'read', auth: 'session', browser: 'headless', profile: 'optional', options: [empresaOption, { name: 'tipo', kind: 'integer', description: 'DTE type (chooser).' }, { name: 'solo-tipo', kind: 'integer', description: 'Keep only drafts of this type.' }],
    output: { description: '{ empresa, borradores }' }, errors: ['INVALID_INPUT', ...sessionErrors], contractRef: `${SII_DOCS}#electronic-invoicing`, discoverWith: [EMPRESAS],
    run: (input, context) => withScope(context, profileOf(input), 'electronic-invoicing', async (runtime) => {
      const tipoDte = num(input, 'tipo'); const soloTipo = num(input, 'solo-tipo');
      const listed = await dteBorradorList(runtime, { empresa: str(input, 'empresa') ?? '', ...(tipoDte !== undefined ? { tipoDte } : {}) });
      return soloTipo === undefined ? listed : { ...listed, borradores: listed.borradores.filter((item) => item.tipoDte === soloTipo) };
    }, EMPRESAS),
  },
  {
    service: 'sii', path: ['dte', 'borrador', 'save'], summary: 'Save (never emit) a draft factura from private JSON.',
    effect: 'write', auth: 'session', browser: 'headless', profile: 'optional',
    positionals: [{ name: 'invoice', kind: 'path', required: true, description: 'Private invoice JSON (mode 0600).' }],
    options: [{ ...empresaOption, required: false, description: 'Empresa RUT override for the JSON.' }, { name: 'ciudad', kind: 'string', description: 'Emitter city override.' }, { name: 'fecha', kind: 'date', description: 'Emission date override.' }, { name: 'borrador', kind: 'string', description: 'Existing draft id to update in place.' }],
    output: { description: 'DteBorradorSaved' }, errors: ['INVALID_INPUT', ...sessionErrors], contractRef: `${SII_DOCS}#electronic-invoicing`, discoverWith: [EMPRESAS],
    run: async (input, context) => {
      const args = facturaArgs(await privateJson(input.positionals.invoice as string) as FacturaJson, input);
      return withScope(context, profileOf(input), 'electronic-invoicing', (runtime) => dteBorradorSave(runtime, args), EMPRESAS);
    },
  },
  {
    service: 'sii', path: ['dte', 'borrador', 'delete'], summary: 'Delete one draft; --confirm must equal the draft id.',
    effect: 'destructive', auth: 'session', browser: 'headless', profile: 'optional',
    positionals: [{ name: 'borrador-id', kind: 'string', required: true, description: 'Draft id.', discoverWith: 'portales sii dte borrador list --empresa <rut> --profile <profile>' }],
    options: [empresaOption, { name: 'tipo', kind: 'integer', description: 'DTE type (chooser).' }], confirm: { description: 'The draft id.' },
    output: { description: 'Deletion result' }, errors: ['INVALID_INPUT', 'CONFIRMATION_REQUIRED', ...sessionErrors], contractRef: `${SII_DOCS}#electronic-invoicing`,
    run: (input, context) => {
      const borradorId = input.positionals['borrador-id'] as string;
      requireConfirm(input, borradorId, 'the draft id');
      return withScope(context, profileOf(input), 'electronic-invoicing', (runtime) => { const tipoDte = num(input, 'tipo'); return dteBorradorDelete(runtime, { empresa: str(input, 'empresa') ?? '', borradorId, ...(tipoDte !== undefined ? { tipoDte } : {}) }); }, EMPRESAS);
    },
  },
];

export const siiService: ServiceSpec<CliDependencies> = {
  slug: 'sii', title: 'SII', description: 'Chilean SII: authentication, RCV, boletas de honorarios, and MIPYME DTE drafts/reads.',
  docs: SII_DOCS, commands,
};
