# Declaration preparation — observed 2026-09-14

Machine-checkable twin: [`declaration.json`](declaration.json); validate with `portales contract validate`.

## Scope and evidence

The observed branch is a Chilean adult using a Chilean identity document,
without ClaveÚnica or luggage for minors, arriving by commercial aircraft at a
SAG-only control. Travel and identity values are intentionally omitted.

Continue an existing browser draft, choose nationality, then `SIN CLAVE ÚNICA`.
The identification screen asks for first names, surnames, email, gender, and
whether minors' luggage is included. The travel screen asks for document type,
document number, origin country, entry mode, border control, transport, and date.
The SAG screen asks whether plant or animal products are carried.

Observed controls and dependencies:

- Nationality and origin use searchable Ionic radio dialogs. Origin excludes
  Chile, unlike nationality. Never reuse the complete nationality list unchanged.
- Gender is `ion-select[formcontrolname="generoId"]` with an alert dialog.
- The document modal has a radio-bearing row around the nested radio. The outer
  row is interactive; clicking the nested accessibility node can time out.
- Document input is `ion-input[formcontrolname="numeroDocumento"]`; choosing
  a document type clears it. Select type before entering the document number.
- Origin is `ion-item#seleccionar-pais-origen`. Entry-mode buttons load controls;
  wait for the loading overlay to disappear before opening the control picker.
- Control picker is `ion-item#seleccionar-control`; it retains active controls
  of the chosen entry mode. Transport is
  `ion-select[formcontrolname="tipoTransporteId"]`, populated for that control.
- The date calendar exposes today through `today + diasAnticipacion - 1`.
  Source: `onNombreControlFronterizoIdChange` in the loaded
  `9007.b1c5c25f565af872.js`; the visible calendar confirmed its inclusive bounds.
  Use America/Santiago, not the execution host's calendar date.
- Gender and transport Ionic select hosts respond to their DOM `click()` when
  their shadow accessibility button cannot be interacted with by the browser tool.
  This opens the normal alert; select its radio and accept. Do not assign Angular
  model values or bypass validation.
- Boolean form options have native IDs `1` (yes) and `0` (no).
- No-ClaveÚnica has native ID `0`; ClaveÚnica has ID `1`. Authentication with
  ClaveÚnica was not attempted and remains unsupported by preparation.

## Submission boundary

On the products screen, `I DECLARE` opens an oath dialog; it does not itself
complete submission. The dialog has an initially unchecked agreement checkbox
and `ACCEPT` / `CLOSE`. Source: `mostrarAlertaConfirmacion` in the loaded script;
the real dialog was opened and observed. Checking agreement and accepting is the
irreversible boundary. Require confirmation tied to the exact reviewed intent.
Never retry this action. The real authorized finalization and receipt download
were subsequently observed and reconciled; see [the receipt contract](receipt.md).

## Maintained operations

`options` exposes every choice needed by this observed branch, including dates
by border control. Authentication choices are discovery only; listing ClaveÚnica
does not implement authentication. Customs and foreign-national branches remain
unobserved, and preview rejects them instead of guessing their requirements.

`preview --input <private-json-file>` validates identity format and check digit,
IDs, parent dependencies, arrival date, and the supported declaration branch.
It returns normalized intent, labels, and a deterministic confirmation fingerprint.
It reads the catalogs only, creates no remote draft, and does not claim filing
success or full portal validation. Output contains traveler data and must stay
outside the repository. Reuse the same option rules for discovery and validation.

## Recovery and verification

Stop on unexpected controls, denial, rate limiting, or ambiguous writes. Inspect
the current screen and loading state before concluding a click took effect;
browser tools may report a click while an overlay still intercepts it. Never
repeat a mutation to test that hypothesis. Read current state first.

Synthetic tests cover date rollover and parent isolation. On 2026-09-14 the public
`preview --input <private-json-file>` command completed with exit 0 against live
catalogs. Its normalized identity, parent selections, local arrival date, and
product answer agreed with the prepared browser form. The preview reported no
remote effect and correctly reported submission unavailable. Its private input,
output, and confirmation fingerprint were kept outside the repository.
No account data, browser payloads, or screenshots belong in this contract or fixtures.
