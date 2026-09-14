# BCI Pyme read-only browser flow

- Observation date: 2026-09-14
- Live validation: authenticated browser flow completed
- Effect: read-only discovery and document download

## Observed flow

1. Explicit login enters the RUT and password once from Secret Service.
2. Successful authentication may show an optional device-registration page.
3. The adapter selects only `Omitir` or `Omitir por ahora`; it never registers a device.
4. BCI may leave the original page on the empty `LoginJSFGenerico` relay after authentication. This is a post-login navigation condition, not a failed login.
5. The authenticated convention selector lists one table row per business. The visible convention link is the portal-native business ID and the final cell is its label.
6. Selecting one exact discovered business loads the shell dashboard in the `fe-oss-shell-dashboard` frame.
7. `Mis Movimientos` loads the `fe-oss-shell-mov-cuenta` frame.
8. The current account is identified from the account-cartola widget heading and must match an ID returned by account discovery.
9. The first `Descargar` control opens the observed menu.
10. Selecting `Descargar excel detallado` emits one browser download. PDF is not exposed because its contents cannot yet be tied back to the selected business with the same validation strength.
11. The adapter saves the document under a random private filename and validates permissions, media signature, byte count, and SHA-256 digest.

The download exports the portal's current movements view. The observed interface did not present a date-range dialog, so the public input does not claim or accept a date range.

## Authentication breaker boundary

Submitting the login form alone does not prove failure. The breaker trips only when authentication fails or remains ambiguous before BCI acceptance is established.

The device-registration offer, convention selector, dashboard frame, or unique authenticated movement control positively establishes acceptance. Navigation, parsing, selector, and download failures after that point may be retried through the existing session without re-entering credentials and do not trip the authentication breaker.

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

## Data handling

Business labels and IDs, account labels and IDs, cartola contents, file paths, and descriptors are private financial data. Browser state and downloads live outside the repository in profile-specific directories with user-only permissions. Tests use independently authored synthetic values only.
