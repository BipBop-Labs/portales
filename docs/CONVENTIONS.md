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

Task inputs contain user intent and non-secret identifiers. They never contain credentials, cookies, tokens, browser handles, output streams, or surface-specific flags.

Task results use stable domain names and ISO 8601 strings for dates/times. Monetary amounts use integer minor units plus currency unless the provider's domain requires a more precise representation. Never use binary floating point for money.

Do not return an `ok` boolean around successful data merely because errors exist. Success is the returned value; failure is a typed error. Surfaces may wrap failures for transport.

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

## MCP

MCP tools map one-to-one to tasks and return the same JSON data. Their names begin with the service slug, for example `bci_pyme_movements_list`.

- Apply `readOnlyHint`, `destructiveHint`, and other protocol annotations from the task effect.
- Descriptions state account scope, side effects, and PII exposure plainly.
- No tool accepts a credential, cookie, token, PIN, one-time code, or keyring payload.
- A tool may request login by profile but the runtime reads the keyring outside model context.
- Never place downloaded document bytes or full sensitive raw payloads in MCP text.

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

- Unit and contract tests use fakes and sanitized fixtures.
- Default tests never open a browser, network connection, keyring, or production session.
- Test every public result and typed error at the task boundary.
- Test CLI STDOUT, STDERR, and exit codes.
- Test MCP schemas and annotations when MCP is exposed.
- Live tests are separate, opt-in, serialized, minimal, and read-only unless a real required operation has explicit authorization.
- A parser test includes at least: normal data, empty data, provider error, login-wall response, and changed shape.

## Dependencies

Prefer platform and infrastructure libraries over provider-specific scraper packages. Every dependency must remove more complexity than it introduces. Keep service-specific selectors, endpoints, and payload knowledge in-house and backed by dated first-hand evidence.

## Commits

- One coherent change per commit.
- Conventional Commit subject in English, at most 72 characters.
- Documentation changes ship with the behavior they define.
- Inspect the complete diff and scan for secrets and PII before every push.
