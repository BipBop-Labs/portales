# Issued BHE: PDF and reuse of a previous boleta

- Observed: 2026-09-28, headed browser, authenticated principal.
- Public menu: `https://www.sii.cl/servicios_online/1040-1287.html`.
- Operations: `bte.list`, `bte.download`, `bte.prepare`, snapshot branch of `bte.emit`.
- Scope: issued honorarios of the authenticated principal. No represented-company switch.
- Final emission was not performed during this investigation. The final control invokes the portal validator and the response marker is inherited from the existing emission adapter; production post-write verification remains pending until an authorized real emission.

## Monthly listing and PDF

The public menu's “Consultar boletas emitidas” opens `TMBCOC_MenuConsultasContrib.cgi` on `loa.sii.cl/cgi_IMT/`. The monthly form has `cbmesinformemensual`, `cbanoinformemensual`, `rut_arrastre`, `dv_arrastre`, `pagina_solicitada`. Its “Consultar” control calls `presionaBoton('validar_mensual')`, submitting POST to `TMBCOC_InformeMensualBhe.cgi`. The existing GET replay remains supported and is exercised separately through the CLI.

The legacy HTML places controls outside their form's DOM subtree even though `element.form` associates them correctly. Inspect `document.forms` and `form.elements`; a descendant CSS selector can have zero matches while the button is visibly present. Classify the loaded document before reading inline state, rather than using the return from click as a readiness signal.

Monthly data lives in `xml_values` and `arr_informe_mensual` (string-keyed arrays). Issued rows include `nroboleta`, `fechaemision`, `rutreceptor`, `dvreceptor`, `nombrereceptor`, `totalhonorarios`, `retencion_emisor`, `retencion_receptor`, `honorariosliquidos`, `estado`, and `codigobarras`. Empty reports explicitly have `total_boletas = 0`. The new `codigo` result field is the document barcode, used to reconcile a new emission without guessing a folio.

The row's PDF anchor is `TMBCOT_ConsultaBoletaPdf.cgi` with observed query keys `txt_codigobarras`, `veroriginal=si`, `origen=PROPIOS`, `enviar=si`. The last flag exposes the viewer's send option; this GET does not send email. Follow only a code from the requested principal/month/folio. Received PDFs are outside this operation.

Chromium's PDF viewer exposes generated HTML and internal extension frames in some response events. That HTML is not the downloaded document. The authenticated binary GET to the observed anchor returns `application/pdf`, `%PDF-`. Validate those plus issuer RUT, recipient RUT, and `N ° <folio>` using `pdftotext`; the PDF uses Unicode minus in RUTs and may put whitespace after it. Publish privately and without overwriting, then index an artifact. `coveredPeriod` is null: the document date is not separately parsed from the PDF.

## Source selection and preview

“Por contribuyente con datos usados anteriormente” opens `TMBECN_ValidaTimbrajeContrib.cgi?modo=2`.

- Source form: `formulario`, action `TMBECN_PresentaDatosBoleta.cgi`, method POST; fields `rut_arrastre`, `dv_arrastre`, `prellenar`, `ult_boleta`, `boleta`.
- `prellenar=SI`; “Aceptar” (`input[name="cmdcontinuar"]`) runs `verifica_boleta()`, validates the explicit folio, and sets `ult_boleta=NO`. “Basarse en última boleta emitida” runs `envia()`, sets `ult_boleta=SI`. Only the explicit-folio branch is exposed by the CLI.
- The prefilled form identifies its source with `xml_values.num_ult_boleta`. It fills recipient, domicile, retention, service lines and amounts, but selects the current SII date for the new boleta.
- Read actual populated controls; do not reverse-engineer a recipient's region from address text. The portal's `pre_llenar_datos_dest()` resolves comuna/region and `pre_llenar_prestaciones()` resolves the lines. Emitter domicile uses the selected registered address, which is included in the confirmation fingerprint.
- Supported input overrides: new date and replacement of the complete set of 1..4 service lines. Other recipient/retention/address changes require the existing manual workflow. Forms with additional line capacity stop rather than silently dropping lines.
- “Confirmar Emisión” (`input[name="cmdAceptar"]`) runs `GuardaNuevasFilasEnHidden();presionaBoton('validar')`, including the portal's `validaTodo`, and submits to `TMBECN_ConfirmaTimbrajeContrib.cgi`. This is a preview, not the final issue.
- Preview carries `Monto_Boleta`, `Monto_Retencion`, `Monto_Liquido`, `PorcentajeRetencion` and both parties. Totals must reconcile with the requested lines. The separate final control is `input[name="cmdconfirmar"]`, labelled “Emitir Boleta de Honorarios Electrónica”. Preparation never clicks it.

## Confirmation and recovery

Preparation stores only curated intent and preview in the profile's private store for 15 minutes. It stores no cookies, HTML, CSRF tokens, or hidden-field payload. The returned SHA-256 fingerprint binds source folio, issuer, recipient, domicile, date, detail, retention and calculated amounts.

`bte.emit --snapshot` accepts only that snapshot and its exact fingerprint, with no manual-field overrides. It reopens the source and recomputes the preview. Different principal is `AUTHORIZATION_DENIED`; changed intent/totals are `SNAPSHOT_STALE`; expiry is `SNAPSHOT_EXPIRED`. Before the one final request, it persists the consumed state. A failure after that point is `REMOTE_STATE_AMBIGUOUS`, never a retry. Success requires the issued monthly report to match barcode, date, recipient, status and amounts. A used snapshot stays consumed, including after a successful write.

Use `runs show <run-id>` and `doctor sii --profile <profile>` first. For structural mismatches, inspect the exact flow above in a headed browser and review the smallest changed control or state before modifying the contract. SII has no public `observe` command yet; do not advertise one as a recovery path. A failed or ambiguous emission is reconciled with `bte list <periodo>` for the prepared date, never by another submission. Authentication is explicit, uses the keyring and is never retried.

## Privacy and validation

Recipient details, source identifiers, amounts, service descriptions, PDF contents and preparation files are private account data; none belong in repository fixtures or diagnostics. The public-path test uses independently invented inputs and protects confirmation binding, stale previews, post-write verification and consumption after an uncertain submission. No real emission is used as a test.

Live CLI verification on 2026-09-28: `bte.list` matched the browser for an empty month and a populated month; `bte.download` produced an identity-verified PDF and `artifacts verify` confirmed permissions, size and SHA-256; `bte.prepare` matched the browser prefill and preview without issuing; `bte.options retiene` exposed the manual retention catalog. Final emission and email delivery were not performed. No live account data was retained in this contract or its tests.
