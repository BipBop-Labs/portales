# Issued BHE cancellation

Observed 2026-09-28 in a headed browser, authenticated principal. Operations: `bte.cancel-options`, `bte.cancel-prepare`, `bte.cancel`. Preparation is read-only; final cancellation is destructive.

## Observed navigation and boundary

The official BHE menu (`https://www.sii.cl/servicios_online/1040-1287.html`) exposes “Anulación y observación de boletas emitidas” → “Anular boletas emitidas”. This navigates to `https://loa.sii.cl/cgi_IMT/TMBANU_PrevalidaAnulacion.cgi`. The menu's dummy query parameter is not needed by the form.

Step one contains `formulario`, `Txt_BoletaAnular`, three `OptCausaAnulacion` radios, and `cmdContinuar`. Read the authenticated principal from `xml_values.rut_autentificado` / `dv_autentificado`. Discover the complete radio IDs and labels live through `bte.cancel-options`: nonpayment, services not performed, and typing error. No free-text reason or guessed ID is submitted.

The initial HTML form action points to an emission form, but this is not its actual destination. The observed `TMBANU_Anulacion.js` handler `presionaBoton('validar_anulacion')` validates the reason and folio, then changes the action to `TMBANU_ConfirmarAnulacion.cgi` and POSTs. Use the real button, preserving validation.

Step two has `BtnConfirmar` (“Confirmar Anulación”), `BtnSalir` and iframe `prueba` for the document. The parent's inline `xml_values` provides the document identity, date, barcode, totals, state and reason; the iframe need not be scraped or downloaded. Hidden fields `rut_arrastre`, `dv_arrastre`, `Txt_BoletaAnular` and `Txt_CodigoCausa` must agree with that preview. The boleta must also match the active monthly issued row.

`ConfirmarAnulacion()` selects a warning by recipient type, calls `confirm(...)`, disables both buttons on acceptance, and invokes `presionaBoton('confirmar_anulacion')`. Only then does it POST to `TMBANU_RecepcionAnulacion.cgi`. The supported branch is a domestic identified recipient with the `msg_an` warning. The warning says SII automatically notifies the recipient and explains recipient disagreement and accounting adjustments. Unidentified and special foreign-recipient branches are not implemented; stop before writing.

## Confirmation and verification

Preparation stops at step two. It stores curated document identity, totals, cause and the user-visible warning in the profile's private store for 15 minutes. No cookies, HTML or hidden payload is copied. The fingerprint binds the operation, month and full preview. Final cancellation requires that fingerprint, the same principal, and an unchanged live preview. The snapshot is consumed before the final click. The browser accepts exactly one `confirm` dialog only when its text equals the reviewed warning; it dismisses other dialogs. Default form submissions still dismiss all dialogs.

A successful response navigation alone does not prove cancellation. The task re-reads the issued monthly report and requires the same barcode, folio, recipient, date and amounts, with state `ANUL` and an annulment date. Anything uncertain after consumption is `REMOTE_STATE_AMBIGUOUS`; never repeat the mutation. A used snapshot cannot be reused. Recipient-pending outcomes are not reported as completed annulments.

## Recovery and privacy

Read `runs show <run-id>` and `doctor sii --profile <profile>` on failure. Authentication remains explicit and is never retried. A changed route, field cardinality, identity, preview or warning stops before writing. Observe structural mismatches in a headed browser and repair the smallest difference; SII has no public observe command. For uncertain results use `bte list <periodo>` and inspect cancellation state through the official menu before any further action.

Do not put boletas, identifiers, account data, hidden fields or confirmation results into repository fixtures. Synthetic public-path tests protect preview-only behavior, exact confirmation, account scope, stale previews, expiry, and single execution after an uncertain result.

Live verification on 2026-09-28: `bte.cancel-options` matched the three browser choices; `bte.cancel-prepare` matched the browser document preview without submitting; one user-authorized `bte.cancel` accepted the exact warning once and verified the same monthly document with `ANUL` state and annulment date. No account data or document contents are retained here.
