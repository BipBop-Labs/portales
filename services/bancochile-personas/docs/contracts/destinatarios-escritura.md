# Banco de Chile Personas recipient changes

- Observation date: 2026-10-30 (browser flow and the app's own JavaScript, read as text)
- Live validation: deleting one recipient account completed (DELETE answered 200; the agenda
  then showed the recipient's other accounts only), through a diagnostic run of the same steps
  whose two fixes are in the adapter. A Mi Pass edit (name and two aliases) completed live on
  2026-10-31 the same way. The favourite toggle and a run of both through the public commands
  are pending.
- Effects: `favorite` and `edit` are `write`; `delete-account` is `destructive`

## Where each change happens

The agenda (`#/tef/transferencia-electronica/agenda`) shows one table row per account with a star,
an edit button and a trash button. Its search field filters by alias, name, RUT, bank, account type
and account number. The adapter types the account number and requires exactly one row with that
number and bank.

- **Favourite.** The star in the agenda row sends, immediately and without Mi Pass,
  `POST …/bff-pper-srv-tnsf-agenda/agenda/favorito` with
  `{ identificadorCuenta, idDestinatario, estado: !esFavorito }`. It toggles, so the task skips the
  click when the account is already in the requested state.
- **Delete one account.** The row's edit button opens the "Editar destinatario" panel. The panel
  loads banks, profile and account types, then `GET …/agenda/beneficiarios/id`, and only then
  replaces its account table. Each account row has a trash button that opens an inline question
  ("¿Realmente deseas eliminar este destinario de tu agenda?", the bank's own spelling) with NO / SI.
  SI calls `eliminarCuenta`, which sends, immediately and without Mi Pass,
  `DELETE …/agenda/elimina` with `{ idCuenta, idDestinatario }` for that account only.
- **Name, alias, bank, account number, phone, email.** Edited in the same panel. The name (2 s after
  typing) and each account's "Guardar cuenta" send the whole recipient to
  `POST …/bff-pper-srv-tnsf-agenda-ofd/agenda/ofd/editBeneficiarioPersona`. Observed answer: HTTP 401
  `{ categoria: "Verde", tieneCajaDesafio: "Si", token, … }`, which enables step 3; `Rojo` is declined.
  Step 3's control is `label.mi-pass-box` ("AUTORIZA CON MI PASS"). Clicking it sends
  `POST …/ofd-seg-autr-caja-desafio-v1/autoriza-transaccion`, which the page repeats every 5 s and
  which answers 401 `{ errorCajaDesafio }` while the approval is pending; the panel says "Abre la
  aplicación Mi Pass para autorizar la operación" (no push notification may arrive: open the app).
  After approval the page sends the same edit with the approved token (`tkn` header); its 200
  `{ codigo, idBeneficario, mensaje, cuentas, fechaFinTrx }` completes the edit and the panel shows
  the receipt. Completed live on 2026-10-31 (name and two aliases, approved about 15 s after the
  click, verified in the agenda) through a diagnostic run of the same steps as `destinatarios edit`.

The row trash in the agenda list (outside the panel) opens a different modal that is not used.

## Security observation

Deleting a recipient account and toggling a favourite never asked for Mi Pass or any other second
factor (2026-10-30): an authenticated session alone is enough. Only editing or adding recipient
data goes through Mi Pass. This repository's prepare/confirm gate is therefore the only extra
barrier for these two operations.

## Observed pitfalls (2026-10-30)

- A trash click shortly after the panel loads can land on a row the panel is about to re-render
  and shows no question. Opening the question changes nothing, so the adapter repeats that click
  up to three times while no question is shown. SI is clicked exactly once.
- A click on the `bch-button` host of SI is ignored; the inner `<button>` must be clicked.
- All accounts' collapsed edit rows bind the same alias control; only the expanded one (right after
  the account row, with height) and its own "Guardar cuenta" are used.
- The first "Guardar cuenta" click can run only the async account-type check
  (`GET …/tipocuenta/valida`) and send nothing; a second click is made only when no edit request left.
- Live attempts on 2026-10-30 did not complete: one approval arrived after the five-minute wait had
  closed the browser (the approval alone changes nothing), and the Mi Pass app later answered
  "presentamos intermitencias". The agenda stayed unchanged each time.

## Safety

`destinatarios prepare` reads the live agenda, returns a preview and a confirmation bound to the
profile, the change and the account's current state. Execution re-reads the agenda, requires the
same confirmation, acts once, waits for the portal's answer and re-reads the agenda: success only
when the account shows the new favourite state, or is gone while the recipient's other accounts
remain. No answer, a non-200 answer or an unexpected agenda returns `REMOTE_STATE_AMBIGUOUS`;
inspect `destinatarios show` before anything else. Nothing is retried.
