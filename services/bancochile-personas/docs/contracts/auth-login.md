# Banco de Chile Personas login

- Observation date: 2026-10-30 (public form observed without submission, then one explicit login)
- Live validation: one explicit login accepted on 2026-10-30, no second factor requested
- Effect: authentication

## Observed flow

1. `https://portalpersonas.bancochile.cl/persona/` redirects an unauthenticated browser to
   `https://login.portales.bancochile.cl/login` (Auth0 universal login, title
   "Inicia sesión en tu Banca en Línea | Banco de Chile").
2. The page has one form `loginForm` with a visible text input `#ppriv_per-login-click-input-rut`
   (`userRut`), a visible password input `#ppriv_per-login-click-input-password` (`userPassword`),
   a show-password checkbox, hidden `username`, `username2`, `request_id` and `ctx` fields, and
   one `button[type=button]` `#ppriv_per-login-click-ingresar-login` labelled `INGRESAR`.
3. The RUT field formats as you type. The adapter types the normalized RUT (digits and check
   digit), then verifies locally that the field kept it before submitting.
4. No CAPTCHA widget was present. The page loads device-fingerprinting scripts from
   `vujs.bancochile.cl`/`vul.bancochile.cl`/`vuw.bancochile.cl` and opaque third-party hosts;
   headed Chrome stable is therefore required.
5. One click on `INGRESAR` is the single submission. Acceptance is established when the main
   page is back on `portalpersonas.bancochile.cl`, without an `error` parameter and without a
   visible password input, for three consecutive seconds. The accepted login landed on
   `/mibancochile-web/front/persona/index.html#/home`.
6. The saved `bancochile.cl` cookies and origin storage restore an authenticated session in a
   fresh browser profile for later commands.

7. When the saved session is still valid, step 1 stays on `portalpersonas.bancochile.cl`.
   `auth login` then confirms the authenticated portal, refreshes the saved session and
   returns without submitting credentials (observed 2026-10-30).

## Stop conditions

- Any page other than the login host after the initial navigation (`CONTRACT_MISMATCH`, nothing submitted)
- RUT field not keeping the typed value (`CONTRACT_MISMATCH`, nothing submitted)
- Anti-bot interstitial, CAPTCHA, Mi Pass, dynamic key or other second factor in a heading,
  alert or dialog (`ADDITIONAL_AUTH_REQUIRED`)
- Block (`ACCOUNT_BLOCKED`) or too many attempts (`RATE_LIMITED`)
- No recognized outcome within 90 seconds (`REMOTE_STATE_AMBIGUOUS`)

Stop texts are read only from headings, alerts and dialogs: the login page shows rotating
security tips that mention codes and keys.
