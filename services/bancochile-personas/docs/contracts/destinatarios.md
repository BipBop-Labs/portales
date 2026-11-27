# Banco de Chile Personas recipient agenda

- Observation date: 2026-10-30
- Live validation: `destinatarios list` and `destinatarios show` completed against the real portal
- Effect: read-only

## Observed flow

1. With a restored session, `index.html#/home` of
   `https://portalpersonas.bancochile.cl/mibancochile-web/front/persona/` renders the Angular
   shell. The top menu buttons have class `megamenu__l1-button`; their presence establishes an
   authenticated session. An unauthenticated session leaves for `login.portales.bancochile.cl`.
2. The home may open one promotional `mat-dialog-container` with a `.bch-modal` whose close
   control is `i.ion-ios-close-empty`. It covers the menu; the adapter closes only that dialog.
3. `Transferencias y Pagos → Agenda de Destinatarios` is the route
   `#/tef/transferencia-electronica/agenda`. The adapter navigates to it directly.
4. The route's own UI requests
   `GET /mibancochile/rest/persona/bff-pper-srv-tnsf-agenda/agenda/beneficiarios?pagina=<n>&cantidadItems=100&priorizaFavorito=<bool>`,
   authenticated by cookies only (no token header). The adapter reads those responses; a page
   the UI did not request is fetched once from inside the same page with the same parameters.
5. Each page is `{ beneficiarios: [...], pagina: { totalItems, cantidadItems, masPaginas, paginas } }`.
   **Pages are cut by accounts, not recipients**: `totalItems` counts accounts, `paginas` is the
   current page number (not a total), and `masPaginas` marks whether another page follows. One
   recipient's accounts may continue on the next page.
6. Each recipient has `id`, `nombreRazonSocial`, `rutBeneficiario`, `fechaCreacion` and
   `cuentas[]` with `identificadorCuenta`, `banco`, `codigoBanco`, `nombreTipoCuenta`,
   `nroCuenta`, `alias`, `email`, `esFavorito` (plus fields the adapter drops: the client's own
   RUT, creator user, modification dates, phone).

The page also loads behavioural telemetry (`POST /v3.1/<opaque>` with `csid`/`muid`) and
encrypted logging (`POST /api/v1/sendLogs` with an opaque body). Headed Chrome stable is used.

## Result

`{ total, accounts, recipients: [{ id, name, rut, createdAt, accounts: [{ accountId, bank, bankCode, accountType, accountNumber, alias, email, favorite }] }] }`.
Every value is private. `destinatarios show --id` returns one recipient from the same read.

## Verification and stop conditions

- The number of distinct accounts read must equal `totalItems`; otherwise `CONTRACT_MISMATCH`.
- Any response that does not match the fields above: `CONTRACT_MISMATCH` naming the first path.
- No first page within 30 seconds: `READINESS_TIMEOUT`. More than 50 pages: `CONTRACT_MISMATCH`.
- A missing page that cannot be fetched: `PROVIDER_ERROR`. No request is retried.
