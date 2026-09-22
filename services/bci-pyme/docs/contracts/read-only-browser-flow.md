# BCI Pyme read-only browser flow

- Observation date: 2026-09-17 (download-control accessible name; flow otherwise as observed 2026-09-14)
- Live validation: authenticated browser flow completed
- Effect: read-only discovery and document download
- Machine-checkable twin: [`read-only-browser-flow.json`](read-only-browser-flow.json) (page states, step list, stop conditions); `auth.login` uses [`auth-login.json`](auth-login.json). Validate with `portales contract validate`; observe live structure with `portales bci-pyme observe <operation> --profile <name>`.

## Observed flow

1. The public page exposes one visible RUT input, one visible password input, and one
   native submit button in a POST form whose action is the documented BCI login relay
   and whose target is the top-level page. Explicit login enters the RUT and password
   once from Secret Service and submits through one browser-driver click.
2. Successful authentication may show an optional device-registration page.
3. The adapter selects only `Omitir` or `Omitir por ahora`; it never registers a device.
4. BCI may leave the original page on the empty `LoginJSFGenerico` relay after authentication.
   The adapter makes one read-only navigation to the documented convention selector;
   a valid business listing there establishes acceptance. The relay alone is neither
   success nor failure.
5. The authenticated convention selector lists one table row per business. Wait for a visible business row before inspecting the complete list; navigation completion alone is insufficient. The visible convention link is the portal-native business ID and the final cell is its label.
6. Selecting one exact discovered business loads the shell dashboard in the `fe-oss-shell-dashboard` frame.
7. `Mis Movimientos` loads the `fe-oss-shell-mov-cuenta` frame.
8. The current account is identified from the account-cartola widget heading and must match an ID returned by account discovery.
9. The first visible `Descargar` control in the movements frame opens the observed menu. It is a sibling control, not a descendant of the account widget. Its accessible name is `Descargar` followed by a space and an icon-font glyph (a private-use code point rendered as the dropdown arrow), so the contract records the name with `exact: false`; the adapter matches it as a substring.
10. Selecting `Descargar excel detallado` emits one browser download. PDF is not exposed because its contents cannot yet be tied back to the selected business with the same validation strength.
11. The adapter saves the document under a random private filename and validates permissions, ZIP CRC, XLSX structure, byte count, and SHA-256 digest. The detailed workbook does not carry the selected business label; business and account identity are therefore established from the authenticated UI before download, not inferred from workbook contents.

The download control placement and identity boundary were re-observed live on 2026-09-14 after the prior widget-scoped selector failed. A successful export contained the expected detailed movement columns but no workbook-level legal-name header.

The download exports the portal's current movements view. The observed interface did not present a date-range dialog, so the public input does not claim or accept a date range.

## Authentication breaker boundary

Submitting the login form alone does not prove failure. The breaker trips only when authentication fails or remains ambiguous before BCI acceptance is established.

The device-registration offer, convention selector, dashboard frame, or unique authenticated movement control positively establishes acceptance. Navigation, parsing, selector, and download failures after that point may be retried through the existing session without re-entering credentials and do not trip the authentication breaker.

An independently invoked `businesses.list` command succeeded after the prior login
process had stopped at the relay, proving that BCI had accepted that already-completed
submission. The login detector therefore performs the same single read-only convention
selector probe before classifying a relay outcome as ambiguous.

## Stop conditions

- Login rejection or ambiguity before acceptance
- CAPTCHA, MFA, Turnstile, rate limiting, or account block
- Missing or duplicate business rows or IDs
- A selected business not present in current discovery
- Missing dashboard or movements frame
- Current account not matching an exact discovered account ID
- Missing or duplicate download option
- Missing download event or invalid document signature

No login failure is retried automatically. Post-login reads may be re-run against the authenticated session.

## 2026-09-14 login-adapter correction

A headed, non-authenticating inspection reconfirmed the public form structure above.
The prior adapter invoked the submit button through in-page JavaScript after a trial
click, bypassing the browser driver's normal navigation lifecycle. The prior explicit
attempt then failed immediately with `PORTAL_CHANGED`. The adapter now performs the
single observed native submission directly through the browser driver; synthetic tests
require exactly one click and prohibit hidden trial/evaluate submission behavior.

## Data handling

Business labels and IDs, account labels and IDs, cartola contents, file paths, and descriptors are private financial data. Browser state and downloads live outside the repository in profile-specific directories with user-only permissions. Tests use independently authored synthetic values only.

## 2026-09-14 session loss between CLI commands

The initial failure returned HTTP 200 at the normal selector URL with a static
system-error heading and no business rows. The URL alone therefore does not prove
accepted authentication. Login and session checks now require rows when using the
selector as evidence, and reads report the observed error page before parsing.

Local diagnosis compared cookie metadata in Chrome's profile database with
`BrowserContext.cookies()` immediately after reopening that same profile without
navigation. BCI session cookies were present in the database but absent from the
reopened context; persistent cookies survived. This explained the failure boundary
between a successful login and the next independently invoked read. Increasing row
waits or changing selectors cannot repair that missing session state.

The adapter now checkpoints BCI cookies and origin local storage privately before
closing Chrome and restores them before the next navigation. It saves no foreign-site
state and does not extend cookie expiry. Failed authentication does not create a checkpoint; accepted
post-login state can be preserved even if later navigation fails. There are no
implicit logins or automatic retries.

After the repair, explicit `auth login` followed by an independent `businesses list`
succeeded through the public CLI. If the symptom recurs, inspect only cookie
presence/expiry metadata and private-file permissions first, then the supported
browser flow; never dump cookie values or reset the authentication breaker. A real
expired-session response still requires explicit authentication.

## 2026-09-22 expired session shows the same system-error page

A session saved eight days earlier made `businesses list` (and every recipient
command, which checks the session first) receive the same HTTP 200 selector
system-error page. One explicit `auth login` followed by the same `businesses list`
succeeded, so this page means missing or expired session state, not a portal change.
Session reads now return `SESSION_EXPIRED` for it. Login never uses this check. If
the page appears again right after a successful login, suspect the session
checkpoint (see above) or a portal outage, not credentials.

During live batch export, returning to the selector also exposed a readiness race.
A headed observation showed an initially empty accessibility tree, followed by the
normal business table without another operator action. The selector's own inline
`ocultaSitio` logic reveals its panel after page readiness. The adapter now waits
up to 30 seconds for the existing business-row locator to become visible before
counting/parsing; this is a readiness wait, not a navigation retry. System-error
and expired-session responses still stop the operation.

The export reuses the movements frame opened by account discovery only while it
remains attached at the observed movements destination for the same discovered
business. Switching businesses clears that reference and repeats discovery. Export
still checks the current account and widget immediately before download. This removes
an unnecessary second dashboard load per account; the live dashboard also displayed
a slow-site warning during diagnosis, so reducing navigation matters without raising
timeouts or adding retries.

A separate native Chrome failure cancelled downloads after reopening a profile that
had previously downloaded a file. A synthetic localhost attachment reproduced this
without any BCI navigation. Fresh profiles completed multiple downloads in one
process. Migrating to a clean persistent profile helped only for its first process;
reopening it reproduced the failure. Disabling GPU did not resolve it either.

The maintained adapter therefore restores BCI cookies and local storage into a fresh
temporary headed profile per command and checkpoints only that session state at close.
The initial legacy-profile migration runs locally without authentication or navigation.
This avoids carrying Chrome's internal download/UI state between processes. If a
browser closes unexpectedly, cleanup preserves the original operation error instead
of obscuring it with a failed session checkpoint. For recurrence, compare synthetic
local downloads before making more bank requests; inspect process-exit metadata,
never core contents or copied browser databases.

Live verification after the final repair: the public `cartolas download` command
completed a multi-business batch with exit 0. Both detailed XLSX exports passed the
adapter's UI account checks and workbook validation; independent checks confirmed ZIP
integrity, workbook structure, byte counts, SHA-256 and mode `0600`. No extra login
was needed after preserving the authenticated state.

On Linux the public CLI now uses headed Chrome on Xvfb even with an existing desktop
display. This keeps normal browser rendering while making browser windows invisible.

## 2026-09-17 classification before parsing

The adapter now classifies the page against the JSON contract before reporting a
missing row or control. A system-error page at the selector route, the
expired-session route, or an `Ingresar` button returns `SESSION_EXPIRED` (the
selector error page was reclassified on 2026-09-22; see below); a structure that differs from the recorded state returns
`CONTRACT_MISMATCH` with the smallest diff (for example, expected at least one
visible business row, observed zero) and `nextCommand` pointing at observe mode; a
matching structure whose readiness marker never appears returns `READINESS_TIMEOUT`.
The declarative step list in the JSON `flow` mirrors the code path in
`playwright-portal.ts`; the executor in `src/portal/flows/executor.ts` interprets
it for observation and future refactors. The read paths (`discoverBusinesses`,
`openBusiness`, `downloadCartola`) still run their original code because moving
them onto the executor would have changed the exact waits and locators observed on
2026-09-14; migrate them only after a live observation confirms equivalence.

## 2026-09-17 download-control name is not an exact match

First live exercise of `accounts.options` after classification-before-parsing failed with
`CONTRACT_MISMATCH: expected at least 1 visible button "Descargar", observed 0` while the
account heading was present. `observe accounts.options` captured the movements frame: the
value-stripped aria snapshot shows one visible button whose accessible name is `Descargar`,
a space, and U+E5CF (an icon-font ligature glyph). The 2026-09-14 JSON transcribed the prose
name `Descargar`, which the classifier matched exactly, while the download code has always
located the control with a substring regex. Portal unchanged; contract too strict.

Repair: the control schema accepts `exact: false` for a role/name whose observed accessible
name embeds volatile icon text; the `movements` state and its `click` step record it. This is
a recorded fact, not a broadened selector: `expectedVisibleCount` stays at least 1 and the
name must still contain `Descargar`. Distinguish this case from a missing control by reading
the aria snapshot in `observed.json`: a renamed or removed control shows no `button` line
containing the name at all.

Method note: `observe` must never assert the state it is capturing. It previously reused the
enforcing `openMovements` path and therefore failed with the same mismatch it was meant to
document; it now navigates without classification and captures the dashboard before the
movements click replaces that frame.
