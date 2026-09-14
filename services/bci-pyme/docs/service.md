# BCI Pyme

- Slug: `bci-pyme`
- Official portal: `https://www.bci.cl/corporativo/banco-en-linea/pyme`
- Account scope: businesses and accounts available to one BCI Pyme login profile
- Credential store: operating-system Secret Service
- Authentication: explicit, one attempt, no automatic retry
- Supported effects: read-only discovery and cartola download

## Keyring namespace

BCI uses this exact Secret Service identity:

```text
service = cl.bipbop.portales.bci
account = <profile>
```

For the default profile:

```text
service = cl.bipbop.portales.bci
account = default
```

The namespace intentionally uses `bci`, not the CLI slug `bci-pyme`. Treat it as a stable compatibility contract. Do not derive, rename, alias, or probe alternative namespaces.

The secret is opaque versioned JSON owned only by the BCI authentication adapter. Version 1 has exactly three fields:

- `version`: the integer `1`;
- `rut`: a non-empty string;
- `password`: a non-empty string.

Real values must never appear in documentation, examples, tests, shell history, process arguments, environment variables, logs, or task input.

## Credential setup

Configure the bundle through the operating system's interactive Secret Service tooling:

Credential enrollment is intentionally outside the current CLI surface. Store the
versioned JSON bundle directly through Secret Service using the contract in
[`docs/KEYRING.md`](../../../docs/KEYRING.md); never pass it through command-line
arguments or environment variables.

Do not provide a public command that accepts `--rut`, `--password`, credential JSON, or a credential-file path.

## Login

Login is always explicit:

```text
portales bci-pyme auth login --profile default
```

For the observed `elige-metodo` phone-approval route, an operator may explicitly keep
that same attempt open with:

```text
portales bci-pyme auth login --profile default --wait-for-phone-approval
```

This mode emits a machine-readable waiting status on STDERR, accepts no OTP or PIN,
waits at most 15 minutes, and succeeds only after the authenticated selector or shell
is positively identified. Without the flag, additional authentication retains the
existing immediate-stop behavior.

The implementation must:

1. verify that the BCI login circuit breaker is clear;
2. read `(cl.bipbop.portales.bci, default)` through the read-only `SecretReader`;
3. make exactly one login attempt;
4. persist only the minimum authenticated browser session outside the repository;
5. stop without retry on invalid credentials, unknown completion, CAPTCHA, MFA, Turnstile, access denial, rate limiting, block, or changed stages.

The login control facts (`#rut_aux`, the unique password input, `INGRESAR`, and the
native top-level POST form) were re-observed in a headed browser on 2026-09-14 without
submitting credentials. The adapter uses each exact control once and fails closed on
any mismatch. `Omitir por ahora` remains authenticated-flow evidence from the dated
contract.

Listing and download commands never perform implicit login.

## Browser session

The browser session is separate from the keyring item. It may contain cookies, CSRF values, device identifiers, and local storage, all of which are secrets.

Store session state under a private service/profile-specific location with user-only permissions. Never combine BCI with another portal or organization in one browser profile. Session expiry returns `SESSION_EXPIRED`; it does not trigger login automatically.

A device-registration offer is not authorization to enroll the device. The adapter may choose the observed non-enrollment path only when documented and unambiguous. It must never activate device registration or approval.

## Intended calls

After an explicit successful login:

```text
portales bci-pyme businesses list --profile default
portales bci-pyme accounts options --profile default --business-id <discovered-id>
portales bci-pyme cartolas options --profile default --account-id <discovered-id>
portales bci-pyme cartolas download --profile default --input <private-json-file>
```

Business and account IDs must come from the corresponding discovery command. They must not be guessed from labels or placed in public examples.

The private download input carries selected discovered IDs and document type. It exports the portal's current movements view; the observed UI does not expose a date-range dialog. The result contains private file descriptors only: generated path, media type, byte count, checksum, and per-item status. It never returns document contents.

## Circuit breaker

An authentication failure or ambiguity before BCI accepts the login trips a durable profile-specific circuit breaker. Errors after acceptance are post-login failures and may be retried through the authenticated session without re-entering credentials. Ordinary tasks cannot reset or bypass a genuine authentication breaker. Reset requires explicit human review and a separate administrative operation.

## Forbidden capabilities

The BCI task surface must not include transfers, payments, beneficiaries, approvals, device enrollment, or any other bank write.

## Implemented read-only surface

- `auth.login`: performs one explicit keyring-backed login and trips the profile
  breaker only when authentication fails or remains ambiguous before acceptance.

- `businesses.list`: discovers businesses from an existing authenticated session.
- `accounts.options`: discovers all accounts for one exact discovered business ID.
- `cartolas.options`: lists the documented cartola document types.
- `cartolas.download`: validates discovered IDs and writes verified documents to a private user directory.

The current browser-flow contract records the sanitized live observations in [`contracts/read-only-browser-flow.md`](contracts/read-only-browser-flow.md). It must fail with `PORTAL_CHANGED` rather than broaden selectors when the real portal differs.

## Related documentation

- [OS keyring contract](../../../docs/KEYRING.md)
- [Security and account safety](../../../docs/SECURITY.md)
- [CLI conventions](../../../docs/CONVENTIONS.md)
