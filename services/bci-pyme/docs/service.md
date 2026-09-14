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

Create or replace the bundle only through the interactive command:

```text
portales bci-pyme auth setup --profile default
```

The command prompts for RUT and password with terminal echo disabled and writes the bundle directly to the exact keyring item above. It returns no credential field.

Do not provide a public command that accepts `--rut`, `--password`, credential JSON, or a credential-file path.

## Login

Login is always explicit:

```text
portales bci-pyme auth login --profile default
```

The implementation must:

1. verify that the BCI login circuit breaker is clear;
2. read `(cl.bipbop.portales.bci, default)` through the read-only `SecretReader`;
3. make exactly one login attempt;
4. persist only the minimum authenticated browser session outside the repository;
5. stop without retry on invalid credentials, unknown completion, CAPTCHA, MFA, Turnstile, access denial, rate limiting, block, or changed stages.

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

The private download input carries selected discovered IDs, date range, and document type. The result contains private file descriptors only: generated path, media type, byte count, checksum, and per-item status. It never returns document contents.

## Circuit breaker

Any failed or ambiguous login trips a durable profile-specific circuit breaker. Ordinary tasks cannot reset or bypass it. Reset requires explicit human review and a separate administrative operation. A reset authorizes clearing state, not an automatic login attempt.

## Forbidden capabilities

The BCI task surface must not include transfers, payments, beneficiaries, approvals, device enrollment, or any other bank write.

## Related documentation

- [OS keyring contract](../../../docs/KEYRING.md)
- [Security and account safety](../../../docs/SECURITY.md)
- [CLI conventions](../../../docs/CONVENTIONS.md)
