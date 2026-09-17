# SII received DTE documents (MIPYME portal)

- Observation date: 2026-09-17
- Live validation: read-only listing and one PDF download completed with an own session
- Effect: read-only listing and document download
- Operations: `dte.documentos.list --direction received`, `dte.documentos.download --direction received`
- Adapter: `services/sii/src/portal/dte-recibidos.ts`

## Observed flow

1. The official menu (Servicios online > Factura electrónica > Historial de DTE y respuesta a documentos recibidos) links "Ver documentos recibidos - Generar respuesta al emisor" to `mipeLaunchPage.cgi?OPCION=1&TIPO=4`, the sibling of the emitted route (`OPCION=2&TIPO=4`). The launcher forwards through `mipeSelEmpresa.cgi` (same chooser shapes as the emitted side) and lands on the listing.
2. Listing: `GET mipeAdminDocsRcp.cgi` with query parameter names `RUT_EMI`, `FOLIO`, `RZN_SOC`, `FEC_DESDE`, `FEC_HASTA`, `TPO_DOC`, `ESTADO`, `ORDEN`, `NUM_PAG`. Same names as the emitted listing except `RUT_EMI` (emisor body, digits only) replaces `RUT_RECP`. The response is ISO-8859-1 HTML titled "Administración de Documentos Recibidos".
3. Each row starts with a "Ver" cell whose anchor is `mipeGesDocRcp.cgi?CODIGO=<codigo>&ALL_PAGE_ANT=<page>`, followed by exactly seven cells: emisor RUT, razón social, tipo, folio, fecha (YYYY-MM-DD), monto, estado. The row cardinality is asserted; any other count is a contract mismatch.
4. The document page (`mipeGesDocRcp.cgi`) links "VISUALIZACIÓN DOCUMENTO (pdf)" to `mipeShowPdf.cgi?CODIGO=<codigo>`. A plain authenticated `GET` answers `application/pdf` with a `%PDF-` signature, with or without a Referer header. The adapter sends the document page as Referer.
5. The PDF text (pdftotext) carries the folio as `Nº <folio>` and both RUTs in dotted form (`##.###.###-#`). Dates in the PDF are not in ISO form, so they are not used for validation.

## Response fingerprints

- Listing success: body contains `mipeGesDocRcp.cgi` anchors or the text "Documentos Recibidos" / "No se encontraron".
- Listing rejection: the 200 "Redireccionando" page with an `alert('…')` (shared `serverAlert`).
- PDF success: `content-type: application/pdf` and `%PDF-` magic. HTTP status is never a success signal.
- PDF failure: an HTML "Error al contribuyente" page (shared `contribuyenteError`).

## Stop conditions

- Chooser without options ("sin opciones"): the session belongs to the empresa account, not to an authorized persona. Reported as `CONTRACT_MISMATCH` with the actionable message; never retried.
- Folio absent from the filtered listing: `CONTRACT_MISMATCH`; no PDF request is made.
- Folio present for several emisores: `INVALID_INPUT` asking for `--emisor`; no PDF request is made.
- PDF text missing the folio or a RUT: `DOWNLOAD_INVALID`; the file is not published.

## Not used

- Paging beyond page 1 and the CSV/XLS export (`mipeDownLoad.cgi`) require a reCAPTCHA token in the browser (`agregaToken`, `llamaRecaptchaConCallback`). The adapter narrows with server-side filters instead.
- "Dar Respuesta comercial" and "Dar Acuse de Recibo" (`mipeRespDocRcp.cgi`) are writes and are never called.
- The RCV purchase register's per-document modal (`getDetalleDTE`) shows metadata only; it carries no document link.

## Data handling

Emisor RUTs, razones sociales, folios, amounts and PDF contents are private account data. They stay in the private profile directories and artifact index, never in this repository or in diagnostics.
