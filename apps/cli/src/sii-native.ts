import { constants, readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { PortalError } from '../../../services/bci-pyme/src/errors.js';
import { authStatus, logout } from '../../../services/sii/src/tasks/auth.js';
import { rcvList, rcvListAll, rcvSummary } from '../../../services/sii/src/tasks/rcv.js';
import {
  MAX_ITEMS,
  dteAuthorized,
  dteBorradorDelete,
  dteBorradorList,
  dteBorradorSave,
  dteEmitidos,
  dteEmpresas,
  dtePdf,
  dtePreviewPdf,
  type DteBorradorArgs,
  type DteItem,
  type FormaPago,
} from '../../../services/sii/src/tasks/dte.js';
import { BTE_COMUNAS, bteEmit, bteEmitPreview, bteList, type BteEmitArgs } from '../../../services/sii/src/tasks/bte.js';
import { createPortalesSiiRuntime, siiDocumentsDir } from '../../../services/sii/src/runtime.js';

interface NativeSiiDependencies {
  stdout(value: string): void;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new PortalError('INVALID_INPUT', `${name} requires a value.`);
  args.splice(index, 2);
  return value;
}

function required(args: string[], name: string): string {
  const value = option(args, name);
  if (!value) throw new PortalError('INVALID_INPUT', `${name} is required.`);
  return value;
}

function flag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function positiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new PortalError('INVALID_INPUT', `${name} must be a positive integer.`);
  }
  return parsed;
}

function repeated(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let value = option(args, name); value !== undefined; value = option(args, name)) values.push(value);
  return values;
}

function bteArgs(args: string[]): BteEmitArgs {
  const lineas = repeated(args, '--linea').map((value) => {
    const i = value.indexOf(':');
    const monto = Number(value.slice(0, i));
    const glosa = value.slice(i + 1).trim();
    if (i < 0 || !Number.isInteger(monto) || monto <= 0 || glosa === '') {
      throw new PortalError('INVALID_INPUT', '--linea must be "<monto>:<glosa>".');
    }
    return { glosa, monto };
  });
  const retiene = (option(args, '--retiene') ?? 'receptor').toUpperCase();
  if (retiene !== 'RECEPTOR' && retiene !== 'EMISOR') {
    throw new PortalError('INVALID_INPUT', '--retiene must be receptor or emisor.');
  }
  const fecha = option(args, '--fecha');
  const fechaMatch = fecha === undefined ? undefined : /^(\d{4})-(\d{2})-(\d{2})$/u.exec(fecha);
  if (fechaMatch === null) throw new PortalError('INVALID_INPUT', '--fecha must be YYYY-MM-DD.');
  const enviar = option(args, '--enviar');
  return {
    receptor: required(args, '--receptor'),
    receptorNombre: required(args, '--nombre'),
    receptorDomicilio: required(args, '--domicilio'),
    region: positiveInteger(required(args, '--region'), '--region') ?? 0,
    comuna: positiveInteger(required(args, '--comuna'), '--comuna') ?? 0,
    lineas,
    retiene,
    ...(fechaMatch ? { fecha: { anio: Number(fechaMatch[1]), mes: Number(fechaMatch[2]), dia: Number(fechaMatch[3]) } } : {}),
    ...(flag(args, '--sin-detalle') ? { mostrarDetalle: false } : {}),
    ...(enviar ? { enviarA: enviar } : {}),
    ...(flag(args, '--sin-copia') ? { copiaEmisor: false } : {}),
  };
}

function done(args: string[]): void {
  if (args.length > 0) throw new PortalError('INVALID_INPUT', `Unexpected argument: ${args[0] ?? ''}.`);
}

async function privateJson(path: string): Promise<unknown> {
  if (path === '-') return JSON.parse(readFileSync(0, 'utf8')) as unknown;
  let input;
  try {
    input = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await input.stat();
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
      throw new PortalError('INVALID_INPUT', 'The invoice input must be a private regular file (0600).');
    }
    return JSON.parse(await input.readFile('utf8')) as unknown;
  } catch (error: unknown) {
    if (error instanceof PortalError) throw error;
    throw new PortalError('INVALID_INPUT', 'The invoice input could not be read as JSON.');
  } finally {
    await input?.close();
  }
}

interface FacturaJson {
  empresa?: string;
  tipo_dte?: number;
  fecha_emision?: string;
  ciudad_emisor?: string;
  forma_pago?: string;
  borrador_id?: string;
  receptor?: Record<string, unknown>;
  items?: Record<string, unknown>[];
}

function text(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PortalError('INVALID_INPUT', `Missing ${key} in invoice JSON.`);
  }
  return value;
}

function number(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number') throw new PortalError('INVALID_INPUT', `Missing ${key} in invoice JSON.`);
  return value;
}

function facturaArgs(document: FacturaJson, args: string[]): DteBorradorArgs {
  const receptor = document.receptor ?? {};
  const rawItems = document.items ?? [];
  if (rawItems.length === 0 || rawItems.length > MAX_ITEMS) {
    throw new PortalError('INVALID_INPUT', `Invoice JSON needs 1 to ${String(MAX_ITEMS)} items.`);
  }
  const forma = (document.forma_pago ?? 'credito').toLowerCase();
  const formas: Record<string, FormaPago> = { contado: 'contado', credito: 'credito', 'crédito': 'credito', sin_costo: 'sin_costo' };
  const formaPago = formas[forma];
  if (!formaPago) throw new PortalError('INVALID_INPUT', 'forma_pago must be contado, credito, or sin_costo.');
  const empresa = option(args, '--empresa') ?? document.empresa;
  const ciudad = option(args, '--ciudad') ?? document.ciudad_emisor;
  const fecha = option(args, '--fecha') ?? document.fecha_emision;
  const borrador = option(args, '--borrador') ?? document.borrador_id;
  if (!empresa || !ciudad) throw new PortalError('INVALID_INPUT', 'empresa and ciudad_emisor are required.');
  const items: DteItem[] = rawItems.map((item) => ({
    nombre: text(item, 'nombre'),
    ...(typeof item.descripcion === 'string' ? { descripcion: item.descripcion } : {}),
    cantidad: number(item, 'cantidad'),
    ...(typeof item.unidad === 'string' ? { unidad: item.unidad } : {}),
    precioUnitario: number(item, 'precio_unitario'),
    ...(typeof item.descuento_pct === 'number' ? { descuentoPct: item.descuento_pct } : {}),
  }));
  done(args);
  return {
    empresa,
    ...(document.tipo_dte !== undefined ? { tipoDte: document.tipo_dte } : {}),
    ...(fecha ? { fechaEmision: fecha } : {}),
    ciudadEmisor: ciudad,
    receptor: {
      rut: text(receptor, 'rut'),
      razonSocial: text(receptor, 'razon_social'),
      direccion: text(receptor, 'direccion'),
      comuna: text(receptor, 'comuna'),
      ciudad: text(receptor, 'ciudad'),
      giro: text(receptor, 'giro'),
      ...(typeof receptor.contacto === 'string' ? { contacto: receptor.contacto } : {}),
    },
    items,
    formaPago,
    ...(borrador ? { borradorId: borrador } : {}),
  };
}

export async function runSiiNative(
  originalArgs: string[],
  dependencies: NativeSiiDependencies,
): Promise<number> {
  const args = [...originalArgs];
  const profile = option(args, '--profile') ?? 'default';
  const section = args.shift();
  const command = args.shift();
  const runtime = createPortalesSiiRuntime(profile);
  let result: unknown;

  if (section === 'auth' && command === 'status') {
    done(args);
    result = await authStatus(runtime);
  } else if (section === 'auth' && command === 'logout') {
    done(args);
    result = await logout(runtime);
  } else if (section === 'rcv') {
    const periodo = args.shift();
    if (!periodo) throw new PortalError('INVALID_INPUT', 'RCV period is required.');
    const side = flag(args, '--venta') ? 'VENTA' : 'COMPRA';
    const rut = option(args, '--rut');
    if (command === 'summary') {
      done(args);
      result = await rcvSummary(runtime, { periodo, side, ...(rut ? { rut } : {}) });
    } else if (command === 'list') {
      const codigoTipoDoc = required(args, '--tipo');
      done(args);
      result = await rcvList(runtime, { periodo, side, codigoTipoDoc, ...(rut ? { rut } : {}) });
    } else if (command === 'all') {
      done(args);
      result = await rcvListAll(runtime, { periodo, side, ...(rut ? { rut } : {}) });
    }
  } else if (section === 'bte' && command === 'list') {
    const periodo = args.shift();
    if (!periodo) throw new PortalError('INVALID_INPUT', 'BTE period is required.');
    const side = flag(args, '--recibidas') ? 'RECIBIDAS' : 'EMITIDAS';
    done(args);
    result = await bteList(runtime, { periodo, side });
  } else if (section === 'bte' && command === 'comunas') {
    const region = positiveInteger(option(args, '--region'), '--region');
    done(args);
    result = region === undefined ? BTE_COMUNAS : (BTE_COMUNAS[region] ?? {});
  } else if (section === 'bte' && command === 'emit') {
    const confirm = option(args, '--confirm');
    const input = bteArgs(args);
    done(args);
    if (confirm === undefined) {
      // Preview by default: SII computes retención/líquido without issuing.
      result = { emitida: false, ...await bteEmitPreview(runtime, input) };
    } else {
      const total = input.lineas.reduce((sum, linea) => sum + linea.monto, 0);
      if (Number(confirm) !== total) {
        throw new PortalError('INVALID_INPUT', `--confirm must equal the gross total (${String(total)}).`);
      }
      result = { emitida: true, ...await bteEmit(runtime, input) };
    }
  } else if (section === 'dte' && command === 'authorized') {
    const rut = args.shift();
    if (!rut) throw new PortalError('INVALID_INPUT', 'RUT is required.');
    done(args);
    result = await dteAuthorized(runtime, { rut });
  } else if (section === 'dte' && command === 'empresas') {
    const tipoDte = positiveInteger(option(args, '--tipo'), '--tipo');
    done(args);
    result = await dteEmpresas(runtime, tipoDte === undefined ? {} : { tipoDte });
  } else if (section === 'dte' && command === 'emitidos') {
    const empresa = required(args, '--empresa');
    const tipoDoc = positiveInteger(option(args, '--tipo-doc'), '--tipo-doc');
    const folio = positiveInteger(option(args, '--folio'), '--folio');
    const estado = option(args, '--estado');
    if (estado !== undefined && estado !== 'emitido' && estado !== 'preview') {
      throw new PortalError('INVALID_INPUT', '--estado must be emitido or preview.');
    }
    const receptor = option(args, '--receptor');
    const desde = option(args, '--desde');
    const hasta = option(args, '--hasta');
    const pagina = positiveInteger(option(args, '--pagina'), '--pagina');
    done(args);
    result = await dteEmitidos(runtime, {
      empresa,
      ...(tipoDoc !== undefined ? { tipoDoc } : {}),
      ...(folio !== undefined ? { folio } : {}),
      ...(estado !== undefined ? { estado } : {}),
      ...(receptor ? { receptor } : {}),
      ...(desde ? { desde } : {}),
      ...(hasta ? { hasta } : {}),
      ...(pagina !== undefined ? { pagina } : {}),
    });
  } else if (section === 'dte' && command === 'pdf') {
    const folio = positiveInteger(args.shift(), 'folio');
    if (folio === undefined) throw new PortalError('INVALID_INPUT', 'folio is required.');
    const empresa = required(args, '--empresa');
    const directorio = option(args, '--out') ?? siiDocumentsDir(profile);
    done(args);
    result = await dtePdf(runtime, { empresa, folio, directorio });
  } else if (section === 'dte' && command === 'preview') {
    const path = args.shift();
    if (!path) throw new PortalError('INVALID_INPUT', 'Invoice JSON path is required.');
    const directorio = option(args, '--out') ?? siiDocumentsDir(profile);
    const input = facturaArgs(await privateJson(path) as FacturaJson, args);
    result = await dtePreviewPdf(runtime, { ...input, directorio });
  } else if (section === 'dte' && command === 'borrador') {
    const operation = args.shift();
    if (operation === 'list') {
      const empresa = required(args, '--empresa');
      const tipoDte = positiveInteger(option(args, '--tipo'), '--tipo');
      const soloTipo = positiveInteger(option(args, '--solo-tipo'), '--solo-tipo');
      done(args);
      const listed = await dteBorradorList(runtime, { empresa, ...(tipoDte !== undefined ? { tipoDte } : {}) });
      result = soloTipo === undefined ? listed : {
        ...listed,
        borradores: listed.borradores.filter((item) => item.tipoDte === soloTipo),
      };
    } else if (operation === 'save') {
      const path = args.shift();
      if (!path) throw new PortalError('INVALID_INPUT', 'Invoice JSON path is required.');
      result = await dteBorradorSave(runtime, facturaArgs(await privateJson(path) as FacturaJson, args));
    } else if (operation === 'delete') {
      const borradorId = args.shift();
      if (!borradorId) throw new PortalError('INVALID_INPUT', 'Draft id is required.');
      const empresa = required(args, '--empresa');
      const confirm = required(args, '--confirm');
      if (confirm !== borradorId) throw new PortalError('INVALID_INPUT', '--confirm must equal the draft id.');
      const tipoDte = positiveInteger(option(args, '--tipo'), '--tipo');
      done(args);
      result = await dteBorradorDelete(runtime, { empresa, borradorId, ...(tipoDte !== undefined ? { tipoDte } : {}) });
    }
  }

  if (result === undefined) throw new PortalError('INVALID_INPUT', 'Unknown SII command.');
  dependencies.stdout(`${JSON.stringify(result)}\n`);
  return 0;
}
