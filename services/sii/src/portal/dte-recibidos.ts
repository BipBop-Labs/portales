// Received DTEs in the SII's free MIPYME portal ("Ver documentos recibidos"). Wire contract
// observed live 2026-09-17 with an own session, read-only, from the official menu link
// `mipeLaunchPage.cgi?OPCION=1&TIPO=4` (Servicios online > Factura electrónica > Historial de
// DTE y respuesta a documentos recibidos > Ver documentos recibidos).
//
// Shape mirrors the emitted side (`dte-mipyme.ts`): the listing is `mipeAdminDocsRcp.cgi`
// with the same query parameter NAMES as `mipeAdminDocsEmi.cgi` (RUT_EMI instead of RUT_RECP);
// each row's "Ver" anchor is `mipeGesDocRcp.cgi?CODIGO=<codigo>&ALL_PAGE_ANT=<page>` followed by
// SEVEN cells (emisor RUT · razón social · tipo · folio · fecha · monto · estado). The document
// page links `VISUALIZACIÓN DOCUMENTO (pdf)` → `mipeShowPdf.cgi?CODIGO=<codigo>`, a plain
// authenticated GET answering `application/pdf` (observed with and without Referer).
//
// Only the listing and the PDF are used. The document page also offers "Dar Respuesta
// comercial" and "Acuse de Recibo" (`mipeRespDocRcp.cgi`) — WRITES that this module never calls.
// Paging past page 1 and the CSV/XLS export (`mipeDownLoad.cgi`) are gated by a reCAPTCHA in the
// browser (observed script `agregaToken`), so this module reads page 1 per filter only and
// narrows with the server-side FOLIO / RUT_EMI filters instead of walking pages.
import type { PortalSession } from '../seams/index.js';
import { DteError } from '../errors/index.js';
import {
  CGI,
  cellNumber,
  cellText,
  cellValue,
  contribuyenteError,
  isPdfBytes,
  serverAlert,
} from './dte-mipyme.js';

const RECIBIDOS_URL = `${CGI}/mipeAdminDocsRcp.cgi`;
const RECIBIDO_PAGE_URL = `${CGI}/mipeGesDocRcp.cgi`;
const RECIBIDO_PDF_URL = `${CGI}/mipeShowPdf.cgi`;

/** One received document row — CURATED (no `raw`: the row is emisor identity end to end). */
export interface DteRecibido {
  /** Portal document code from the row's `mipeGesDocRcp.cgi?CODIGO=` anchor; the PDF key. */
  readonly codigo: string;
  readonly emisorRut: string | null;
  readonly emisorNombre: string | null;
  readonly tipoDteDesc: string | null;
  readonly folio: number | null;
  readonly fecha: string | null;
  readonly monto: number | null;
  readonly estado: string | null;
}

export interface DteRecibidosFiltro {
  /** Emisor RUT body (digits only, no DV) — what the CGI's `RUT_EMI` takes (observed validator). */
  readonly emisorBody?: string;
  readonly folio?: number;
  readonly desde?: string;
  readonly hasta?: string;
  readonly tipoDoc?: number;
  readonly pagina?: number;
}

/** Cells after the "Ver" cell, in order (observed 2026-09-17). */
const CELDAS_RECIBIDA = 7;

export function parseRecibidos(html: string): DteRecibido[] {
  const out: DteRecibido[] = [];
  const re = /<a[^>]*mipeGesDocRcp\.cgi\?[^"']*CODIGO=(\d+)[^>]*>[\s\S]*?<\/tr>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const codigo = m[1];
    if (!codigo) continue;
    const cells = m[0].split(/<td[^>]*>/i).slice(1).map(cellText);
    if (cells.length !== CELDAS_RECIBIDA) {
      throw new DteError(
        `La tabla de documentos recibidos del Portal MIPYME cambió de forma: la fila ${codigo} ` +
          `trae ${cells.length} celda(s) y se esperan ${CELDAS_RECIBIDA} ` +
          `(RUT emisor, razón social, tipo, folio, fecha, monto, estado). El scraper está roto.`,
      );
    }
    out.push({
      codigo,
      emisorRut: cellValue(cells[0]),
      emisorNombre: cellValue(cells[1]),
      tipoDteDesc: cellValue(cells[2]),
      folio: cellNumber(cells[3]),
      fecha: cellValue(cells[4]),
      monto: cellNumber(cells[5]),
      estado: cellValue(cells[6]),
    });
  }
  return out;
}

/** The DTEs received by the empresa the session is currently scoped to (select it first with
 *  `resolveAndSelectEmpresa`). Read-only; ISO-8859-1 HTML like the emitted listing. */
export async function fetchRecibidos(
  session: PortalSession,
  filtro: DteRecibidosFiltro = {},
): Promise<DteRecibido[]> {
  const q = new URLSearchParams({
    RUT_EMI: filtro.emisorBody ?? '',
    FOLIO: filtro.folio === undefined ? '' : String(filtro.folio),
    RZN_SOC: '',
    FEC_DESDE: filtro.desde ?? '',
    FEC_HASTA: filtro.hasta ?? '',
    TPO_DOC: filtro.tipoDoc === undefined ? '' : String(filtro.tipoDoc),
    ESTADO: '',
    ORDEN: '',
    NUM_PAG: String(filtro.pagina ?? 1),
  });
  const res = await session.requestForm(`${RECIBIDOS_URL}?${q.toString()}`, { method: 'GET' });
  const rejection = serverAlert(res.body);
  if (rejection) throw new DteError(`El SII rechazó la consulta: ${rejection}`);
  if (!/mipeGesDocRcp\.cgi/i.test(res.body) && !/Documentos Recibidos|No se encontraron/i.test(res.body)) {
    throw new DteError(
      'El SII no entregó el listado de documentos recibidos (mipeAdminDocsRcp.cgi). ' +
        'Puede que la sesión ya no esté viva o que el portal haya cambiado.',
    );
  }
  return parseRecibidos(res.body);
}

/** The PDF representation of one received document, by its listing `codigo`. Success is
 *  decided by `content-type` + `%PDF` magic, never by HTTP status (SII answers 200 for its
 *  error page and for the login-wall bounce). */
export async function fetchRecibidoPdf(session: PortalSession, codigo: string): Promise<Uint8Array> {
  const res = await session.requestBinary(`${RECIBIDO_PDF_URL}?CODIGO=${encodeURIComponent(codigo)}`, {
    method: 'GET',
    headers: { Referer: `${RECIBIDO_PAGE_URL}?CODIGO=${encodeURIComponent(codigo)}&ALL_PAGE_ANT=1` },
  });
  if (!isPdfBytes(res.bytes, res.contentType)) {
    const sii = contribuyenteError(res.bytes, res.contentType);
    throw new DteError(
      sii
        ? `El SII no entregó el documento recibido: ${sii}`
        : `El SII no devolvió un PDF del documento recibido (content-type: ${res.contentType ?? 'desconocido'}).`,
    );
  }
  return res.bytes;
}
