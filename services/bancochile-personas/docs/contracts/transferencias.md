# Banco de Chile Personas transfers to third parties

- Observation date: 2026-10-31 (browser flow and the app's own JavaScript, read as text)
- Live validation: one immediate CLP 1 transfer to an agenda recipient at Banco de Chile completed
  through a diagnostic run of these steps; the movements view then showed the debit. A transfer to
  another bank's account was rejected by the bank after Mi Pass ("El número de cuenta es
  incorrecto, por favor verificar."), with no debit. `transferencias prepare` was run live
  (read-only); `transferencias create` implements these steps and is pending its first live run.
- Effect: `destructive` (moves money)

## Observed flow

1. `Transferencias y Pagos → A Terceros` is `#/tef/transferencia-electronica/transferencia-terceros`.
   Loading it calls `POST …/nueva-tef-rest/nueva-tef/propertiesTef` (per-bank accumulated limits) and
   `…/filtrosTef`, and reads the agenda.
2. Step 1: "¿Cuándo deseas realizar la transferencia?" radio, `Inmediata` selected by default.
3. Step 2: "Cuenta de cargo" `mat-select` (the current account by default); "Destinatario" input
   that searches by name, alias, RUT or account number. Typing the full account number left exactly
   one `mat-option`, labelled alias and bank only (no number); the adapter must require one option
   of the expected bank and then check the number in the summary. `monto` input (validators:
   required, min 1, available balance), `mensaje` textarea (max length in the app), optional e-mails.
   A card beside the form shows the recipient's name, RUT, account type and number.
4. Step 3: "Confirma los datos ingresados" summary (origin account masked, amount, recipient name,
   RUT, destination account and bank) and a `CONFIRMAR` button.
5. `CONFIRMAR` sends `POST …/tef-similares-rest/tef-similares`, `POST …/nueva-tef/validar-tef`
   (200, `{ datosValidos, encryptedDataTef, respuestaFraude, orquestadorTEFInput, … }`) and
   `POST …/nueva-tef/ofd/orquestadorTefEncrypted/nivel1`, which answered HTTP 401
   `{ categoria, terceraClave, tieneCajaDesafio, score, versionRegla, token }`: Mi Pass required.
   Request bodies are encrypted in the browser, so the flow must be driven through the UI.
6. Step 4: `label.mi-pass-box` ("AUTORIZA CON MI PASS"), the same challenge box as recipient edits:
   `autoriza-transaccion` is repeated every 5 s while pending. Approve in the Mi Pass app.
7. After approval the page sends `orquestadorTefEncrypted/nivel1` again with the token. Success:
   HTTP 200 `{ mensaje, idTx, fechaTransferencia, saldoCtaCargo, notificacionDataEnvio, … }` and a
   receipt ("Monto transferido", destination, message, `DESCARGAR`, `HACER OTRA TRANSFERENCIA`).
   Bank rejection: HTTP 400 `{ codigo, mensaje, severidad, url }` with the message on the page.
8. An unapproved challenge expires after about three minutes: "El envío de Mi Pass no ha sido
   posible, favor reintentar" with a `Reintenta` control. Nothing is debited.

## Notes

- A Friday-evening transfer posted with the next business day's accounting date.
- The page warns that, for a new or edited recipient account, the first 12 hours have an
  accumulated limit of CLP 350,000 per destination bank or account type.
- Verify a completed transfer in `movimientos list` (default view), never from the receipt alone.

## Commands

```text
portales bancochile-personas transferencias prepare --profile <p> --recipient-id <id> --account-id <id> --amount <clp> [--message <text>]
portales bancochile-personas transferencias create  --profile <p> --recipient-id <id> --account-id <id> --amount <clp> [--message <text>] --confirm <confirmation>
```

`prepare` (`read`) checks the account in the live agenda and the amount against the current
account's available balance, and returns the preview and a confirmation bound to the order, the
destination account and the origin. `create` (`destructive`) re-checks, records the origin's
movement IDs, fills the form, refuses to click `CONFIRMAR` unless the bank's summary shows the
requested destination account and amount, clicks it once, clicks the Mi Pass control once
(`awaiting-mipass` on STDERR), waits up to five minutes, and succeeds only when exactly one new
debit of the amount appears in the movements. A rejection before Mi Pass or an expired challenge
reports that nothing was transferred; anything uncertain is `REMOTE_STATE_AMBIGUOUS`. Only the
current account as origin and immediate transfers are supported.
