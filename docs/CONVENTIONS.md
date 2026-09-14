# Conventions

These are the default contracts for every service. Service documentation may narrow them but may not weaken the security and write-safety rules.

## Language and modules

- TypeScript, strict mode, ESM, named exports.
- Use `unknown` at external boundaries and narrow it with schemas. Do not use `any` without a local explanation.
- Keep provider terminology in its native language when translation would obscure the portal's artifact or field name.
- Files and CLI words use lowercase kebab-case. Code symbols use conventional TypeScript casing.
- Comments document non-obvious contracts, provenance, units, invariants, side effects, and portal quirks. They do not narrate adjacent code.

## Public task contract

Each operation exports one task and metadata equivalent to:

```text
service: stable service slug
operation: stable noun.verb name
effect: read | write | destructive
auth: public | session
input: boundary-validated, JSON-compatible object
result: JSON-compatible object or file descriptor
errors: small typed set
```

The exact TypeScript shape should be introduced with the first implementation, not guessed in advance.

Task inputs contain user intent and non-secret identifiers. They never contain credentials, cookies, tokens, browser handles, output streams, or CLI presentation flags.

Task results use stable domain names and ISO 8601 strings for dates/times. Monetary amounts use integer minor units plus currency unless the provider's domain requires a more precise representation. Never use binary floating point for money.

Do not return an `ok` boolean around successful data merely because errors exist. Success is the returned value; failure is a typed error. The CLI may wrap failures in its stable error shape.

## CLI

Canonical shape:

```text
portales <service> <resource> <action> [arguments]
portales <service> auth login --profile <name>
```

Rules:

- JSON is the default on STDOUT.
- `--human` enables a human renderer without changing the task.
- Diagnostics, progress, and active-account headers go to STDERR.
- A command computes one result and emits it once.
- Errors use a stable JSON object on STDERR when not in human mode:

```json
{
  "error": {
    "code": "SESSION_EXPIRED",
    "message": "The session expired. Log in again.",
    "retryable": false
  }
}
```

Suggested exit codes:

- `0`: success
- `1`: unexpected/internal failure
- `2`: invalid input
- `3`: not authenticated or session expired
- `4`: login failed or additional user authentication required
- `5`: authorization denied
- `6`: rate limited or account blocked
- `7`: portal contract changed
- `8`: confirmation required or mismatched

Do not use an exit code to claim a write succeeded. Verify live state first.

## Portal-defined options

An agent must never guess the accepted value for a select, radio group, autocomplete, location, account, document type, transport type, or other portal-defined choice. Every constrained task input has a corresponding read-only CLI discovery command:

```text
portales <service> <resource> options
portales <service> <resource> options <field> [parent filters]
```

With no field, `options` returns every selector catalog required by the resource. With a field, it returns all currently valid values for that selector. Dependent selectors accept their parent selection as a filter. For example:

```text
portales sag declaracion-jurada options
portales sag declaracion-jurada options border-control --entry-mode air
```

The JSON result uses canonical machine IDs separately from human labels:

```json
{
  "field": "border-control",
  "dependsOn": { "entryMode": "air" },
  "options": [
    {
      "id": "synthetic-location-id",
      "label": "Synthetic Airport",
      "aliases": []
    }
  ]
}
```

The example above is intentionally synthetic and is not a portal fixture.

Rules:

- Return the complete valid set, not a hand-picked subset.
- Prefer live portal data when the list is dynamic. If values are packaged, document first-hand evidence that they are stable and expose the observation date.
- Preserve portal-native IDs as strings even when they look numeric. Labels are display data, not identifiers.
- Include parent dependencies explicitly. Never flatten incompatible child values into one ambiguous list.
- Use the same task and parser for discovery and later validation so the two cannot drift.
- Reject unknown IDs locally before submission and point the error to the exact `options` command that resolves it.
- `--help` names the discovery command beside every constrained argument.
- Option discovery is read-only, JSON by default, contains no PII, and follows the normal authentication and pacing rules.
- When adding a discovery test, cover the useful public path and completeness of independently synthetic options. Do not generate a separate suite for every field.

## Errors

Use a small cross-service set where semantics are shared:

- `INVALID_INPUT`
- `NOT_AUTHENTICATED`
- `SESSION_EXPIRED`
- `LOGIN_FAILED`
- `AUTHORIZATION_DENIED`
- `ADDITIONAL_AUTH_REQUIRED`
- `RATE_LIMITED`
- `ACCOUNT_BLOCKED`
- `PORTAL_CHANGED`
- `CONFIRMATION_REQUIRED`
- `REMOTE_STATE_AMBIGUOUS`

Provider messages may be attached after redaction. Preserve an authoritative Spanish portal message when translation would make it less useful. Do not label a deterministic portal change as retryable.

## Writes

- Separate prepare/preview from commit when the portal supports it.
- Reversible writes require explicit write intent.
- Destructive operations require an operation-specific confirmation value, such as a target ID or amount fingerprint, not a generic boolean.
- Execute once. On ambiguous response, query current state before considering any retry.
- Record the returned identifier immediately and verify the intended account, target, and load-bearing values.
- Never bypass the portal's own client-side validator. Invoke or reproduce it only after observing its real behavior.

## Pacing and batches

All delays use the injected `Clock`. Keep one mutation in flight per account. Pace multi-call reads. Default concurrency for an authenticated portal is one until observation proves otherwise.

Configuration is not a substitute for design. Expose a rate or timeout only if operators can choose a better value than the implementation. Otherwise measure or choose a conservative internal default.

## Testing

- Automated tests use independently authored synthetic data; create a fake or fixture only when a specific check needs it.
- Default tests never open a browser, network connection, keyring, or production session.
- Prefer one lean public-command test when it catches a meaningful failure. Check its output and exit behavior in that same test instead of duplicating coverage at every layer.
- Add narrower tests for actual regressions or identified fragile boundaries. State the failure each new test prevents; do not require exhaustive result, error, or parser matrices.
- Zero new tests is acceptable for changes without a useful automated assertion. Preserve checks for secrets, account scope, authentication limits, and single execution of mutations.
- Live tests are separate, opt-in, serialized, minimal, and read-only unless a real required operation has explicit authorization.
- Run the relevant existing checks once after the final change; broaden only for dependencies, failures, or an identified risk. Passing tests does not establish that a live portal operation works.

## Dependencies

Prefer platform and infrastructure libraries over provider-specific scraper packages. Every dependency must remove more complexity than it introduces. Keep service-specific selectors, endpoints, and payload knowledge in-house and backed by dated first-hand evidence.

## Commits

- One coherent change per commit.
- Conventional Commit subject in English, at most 72 characters.
- Documentation changes ship with the behavior they define.
- Inspect the complete diff and scan for secrets and PII before every push.
