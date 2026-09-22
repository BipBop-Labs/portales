# BCI Pyme destinatarios

- Observation date: 2026-09-14
- Machine-checkable twin: [`destinatarios.json`](destinatarios.json); validate with `portales contract validate`.
- Scope: selected business's saved transfer recipients
- Observed read flow: business selector → dashboard → `Mis Destinatarios` →
  `Agregar destinatario`
- Frame: `/nuevaWeb/fe-destinatarios-pyme/destinatarios/listados`, then
  `/nuevaWeb/fe-destinatarios-pyme/destinatarios/creacion`

The listing separates `Autorizados` and `Por autorizar`. Creation shows name (maximum
40 characters), alias (25), RUT (12 displayed characters), optional email (50), one
native bank selector, account number (18), and an optional favorites checkbox.
The bank selector loads asynchronously; its `%` placeholder is not a valid bank ID.
`destinatarios options --profile <profile> --business-id <discovered-id>` returns every
bank option from that live selector. Bank labels are display values; preserve IDs
and account numbers as strings, including leading zeroes. No account-type selector
was visible on the initial form; do not invent a task field for it.

Use exact accessible textbox names to fill the form. Placeholder locators match
both the custom wrapper and its native input, making them ambiguous. Selecting a
bank and filling a valid recipient enables `Agregar destinatario`; the observed
selected-bank form still had no account-type control.

One authorized submission opened `Detalles de Destinatarios`, showing the recipient
RUT, name, alias, bank, account, business RUT and agreement number, followed by
`Autoriza Destinatarios con Bcipass`. This initiates an actual authorization request;
it is not a harmless preview. The user must approve it in BciPass. Do not submit
again or treat this challenge as a completed creation. The success state and
post-write verification for that initial attempt were incomplete. Never use synthetic
recipients in the live bank to establish that contract.

Recipient names, aliases, RUTs, accounts and email addresses are private account data.
Do not copy rows or form values into tests, docs or logs. Stop on changed form fields,
missing or ambiguous controls, failed account scope, additional authentication or an
ambiguous write result. Reconcile through the recipient listing before any further
submission.

During browser research, inspect script/resource URLs only as origin plus pathname,
excluding analytics resources. Loaded asset URLs can contain session tokens in query
parameters. Do not print raw URLs, headers or payloads. If exposed, end the session
through the portal's logout and verify its successful logout screen before explicitly
authenticating again.

## Listing verification (2026-09-14)

`destinatarios list --profile <profile> --business-id <discovered-id>` was exercised
against the live portal and verified against both status tabs and recipient details.
The task validates business discovery before navigation and never authenticates or
submits a write. The adapter reads each row's `detalle` image control, then the
`bci-wk-modal` containing `Detalle del destinatario`. Its `.modal-row` entries contain
`.modal-row-title` / `.modal-row-data` pairs for name, alias, RUT, email, bank and
account. Close that modal using its exact `close` button before reading another row.
The bank may display a saved account without its original leading zero; return the
observed string unchanged, and do not infer a different account or account type.

The observed empty pending tab says `No existen destinatarios por autorizar`.
Pagination exposes `keyboard_arrow_right`; only single-page status lists have been
verified. An enabled next-page button stops with `PORTAL_CHANGED`, without emitting
partial results. Observe pagination or an empty authorized tab before supporting
those additional states; do not guess their loading behavior.

After a BciPass creation challenge, the portal showed `Ocurrió un problema` and
`Por ahora no podrás continuar con tu solicitud.` Acknowledging `Entendido` returned
to the listing, where the requested recipient existed under `Por autorizar` with
matching details. Thus an authorization error does not imply creation rolled back.
Reconcile both tabs and details before any new submission; never duplicate the
recipient or claim it is authorized solely from the user's BciPass approval.

## Pending authorization investigation (2026-09-14)

Open `Por autorizar`, verify the requested row through its detail modal, and select
only that row before `Autorizar`. The native checkbox is positioned off-screen;
`check()` cannot operate it. Its associated label has zero height and draws a visible
24-by-24 `::before` checkbox. Hidden responsive copies also exist. Identify the
visible row's accessible checkbox, resolve its parent label, and inspect the current
pseudo-element geometry before clicking its displayed center; verify `checked` and
the exact selected recipient count afterward. Never use the header select-all control.

The observed `Autorizar` click starts BciPass immediately with recipient and business
details. Keep the same page and session open while awaiting the user's phone approval.
Do not navigate, close the challenge, submit again, or open another session during
that wait. A phone approval alone is not completion: wait for the portal outcome and
then verify the exact recipient in the authorized listing.

With the page kept open, phone approval changed the challenge to `Verificando BCIPass`,
then `Autorización exitosa` and `Agregaste con éxito 1 destinatarios.` The success page
shows the selected recipient and bank, plus `Transferir` and `Agregar otro destinatario`.
Neither button is needed for verification. Close only after that terminal outcome,
then exercise the public listing to reconcile authorized and pending state. The
initial authorization write was observed through the browser; it does not by itself
verify a public CLI authorization command.

## Maintained CLI workflow

`destinatarios prepare --action create|authorize` and the corresponding `create` /
`authorize` commands now share discovery, confirmation and live verification in the
service task. The create preview fills the observed form without submitting. The
authorization preview identifies one existing recipient through the list. Both
commands require a fingerprint tied to the exact preview and current recipient state.
The existing-recipient branch never sends a duplicate creation or approval request.

The authorization browser owns the complete submitted request: it stays on the same page while
`Autoriza Destinatarios con Bcipass` and `Verificando BCIPass` are visible, returning
only after the observed success or terminal error. Five minutes without a recognized
outcome is ambiguous, not success. Only after a terminal outcome does the task reopen
the listing, match RUT, bank and account (allowing the bank's omitted leading zeroes),
and verify the saved details and authorization state. No fallback request or automatic
resubmission exists. Progress contains static stages only, with no recipient data.

The initial live CLI create saved the exact requested recipient as pending, but
post-verification exposed a bank-label mismatch: the catalog says `Banco Santander /
santiago` and saved details say `Banco Santander-santiago`. Match this observed pair
explicitly; do not strip arbitrary punctuation from every bank label. The regression
test covers this mismatch and rejects unrelated labels. The existing record was
reconciled through `destinatarios list`, never recreated.

The requested default now separates creation and approval: on reaching the observed
post-creation challenge, `create` proceeds to listing verification without requesting
phone approval. Only `authorize` waits for BciPass. This removes reliance on the
creation screen's automatic approval flow, which repeatedly ended in an error despite
saving the recipient. The revised early handoff was verified through the public CLI
on 2026-09-14 for an explicitly requested creation: `create` submitted once, emitted
`verifying-created-recipient`, and returned `outcome: pending` after matching the
saved details in the listing. It did not wait for phone approval or run `authorize`.
Do not create throwaway recipients or revoke existing ones to exercise this flow.

The standalone `destinatarios authorize` command was exercised against a real pending
recipient on 2026-09-14. It emitted `awaiting-bcipass`, kept the page open through the
phone approval, observed `Autorización exitosa`, and verified the exact authorized
recipient through the maintained listing before exiting successfully.

## Deletion (2026-09-14)

On the selected row, the `eliminar` image opens an inline confirmation row containing
`¿Quieres eliminar a <name> de tus destinatarios?`, `Volver` and `Eliminar`. This was
observed with a real explicitly requested target; `Volver` dismissed the preview
without deletion. The observed lazy frontend resource's `cargarConfirmacionEliminar`
uses the recipient name and binds only the primary button to `emitEliminar`.
The question contains a `<br>` between `tus` and `destinatarios`. A normal exact
text-content locator joins those words and fails before submission. Read the visible
paragraphs' `innerText`, normalize whitespace, and require exactly one question for
the exact recipient name. The regression fixture is synthetic and checks that a
different name or duplicate question is rejected.

The public delete task shares exact business/bank discovery and recipient identity
matching with authorization, requires an operation-specific preview fingerprint,
rechecks all detail fields, then clicks the exact confirmation once. Wait for the
target row to disappear and verify absence through both status listings. Do not infer
success from the button click or HTTP status. No BciPass deletion challenge has been
observed; if one appears, stop rather than guess how to approve it.

The public `destinatarios delete` command was exercised successfully on 2026-09-14:
one explicitly requested recipient disappeared from the visible table, and the task
verified absence from both status listings before returning `outcome: deleted`.
No BciPass was required for this deletion. No live account data is kept in this
contract or tests; fixture identities are authored independently as synthetic.

## Dashboard announcement and help bubble (2026-09-22)

`destinatarios options` failed with the CLI's generic `PORTAL_CHANGED` ("could not be
completed safely"), which hides raw Playwright errors. A temporary local script calling
the compiled adapter showed the real error: `locator.click` timing out on the
`Mis Destinatarios` shortcut. Two things covered it: a new modal announcement in
the `fe-oss-shell-layout` frame (`[role=dialog][aria-modal=true]`, closed by its single
`img.cerrar-modal-vertical`), and the fixed `embeddedServiceHelpButton` help bubble,
which overlapped the bottom-right `Accesos Directos` card. A Playwright trial click
(`click({ trial: true })`) names whichever element intercepts the click without
clicking.

The announcement is optional. It appeared about 20 s after business selection, at the
same time as the shortcut, in one session and was absent from a later one. The
adapter's `clickDashboardShortcut` therefore makes short click attempts for up to
30 s. Before each attempt it closes the announcement if one is visible, then scrolls
the shortcut to the viewport center. Playwright dispatches no click while the target
is covered, so repeating this read-only navigation cannot double-submit. `Mis
Movimientos` uses the same helper. Verified both with and without the announcement
by running `destinatarios options` through the public CLI.

## Saved names are title-cased (2026-09-22)

A public `create` submitted an uppercase company name once and then failed
verification with `Saved recipient details did not match`. Reconciliation through
`destinatarios list` showed exactly one pending recipient: RUT, bank, account, alias
and email matched, and BCI had saved the name in title case. Alias and email came back
unchanged. Name comparisons (duplicate check and post-write verification) now ignore
case only. After the fix, a fresh `prepare` for that business reported the existing
recipient with `willWrite: false`, and a second business's `create` returned `outcome:
pending` directly.

In one run, `create` stopped before submission with `Expected exactly one authorized
recipients tab`. No `verifying-created-recipient` stage was emitted, and the listing
showed no new recipient. Six repeated read-only runs of the same pre-submit steps did
not reproduce it, and the next fresh preview plus `create` succeeded. If it recurs,
capture the destinatarios frame's visible tabs and headings before changing selectors.
