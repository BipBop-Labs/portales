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

Canonical shape (updated 2026-09-17):

```text
portales <service> <resource> <action> [arguments]
portales <service> auth setup|status|login|logout --profile <name>
portales <service> auth breaker status --profile <name>
```

Global commands never take a profile or contact a portal:

```text
portales --help | portales <service> --help | portales <service> <resource> --help
portales catalog --json                      every service, command, effect, auth, arguments, errors
portales describe <service> <resource> <action> --json
portales version --json                      package version, commit, build time, checkout, stale status
portales doctor [service] --profile <name>   local readiness checks only
portales runs list | runs show <run-id>
portales artifacts list | latest | show <id> | verify <id>
portales contract check <run-id>
```

Every command is declared once in the task registry (`packages/runtime/src/registry.ts`); help, catalog, describe, argument validation, and dispatch derive from that declaration. Do not hand-write help text or duplicate argument parsing.

Rules:

- JSON is the default on STDOUT. `--json` is accepted everywhere and changes nothing; `--human` pretty-prints without changing the task.
- A command computes one result and emits it once, wrapped in the versioned envelope below.
- Diagnostics, lifecycle events, and errors go to STDERR as JSON lines.
- `--profile <name>` selects the keyring account and private state; `--input <path>` reads a private (0600) JSON file for batches or sensitive payloads; simple single-item reads take direct flags instead.
- `--output <dir>` or `--destination <alias>` places a verified artifact directly in a private directory outside any checkout; the default isolates by service, profile, document type, and every selected identifier.
- `prepare` validates dependent options once and returns a normalized intent plus a fingerprint (and, where implemented, a short-lived snapshot id) that the executing command requires through `--confirm` or `--snapshot`.
- `--confirm <value>` is operation-specific (fingerprint, id, or amount), never a boolean.

### Result envelope

```json
{
  "schemaVersion": "1",
  "service": "bci-pyme",
  "operation": "businesses.list",
  "runId": "run_20260917120000_0a1b2c3d",
  "browserMode": "headed-xvfb",
  "result": { }
}
```

`browserMode` is one of `headed-xvfb`, `headed-desktop`, `headless`, `none`.

### Error envelope (STDERR)

```json
{
  "schemaVersion": "1",
  "service": "bci-pyme",
  "operation": "cartolas.download",
  "runId": "run_20260917120000_0a1b2c3d",
  "error": {
    "code": "CONTRACT_MISMATCH",
    "message": "Expected exactly one visible download control.",
    "retryable": false,
    "stage": "navigate",
    "reason": "contract-mismatch",
    "lastCompletedStage": "session-check",
    "nextAction": "Do not broaden selectors or retry. Observe the operation and propose a contract diff.",
    "nextCommand": "portales bci-pyme observe cartolas.download --profile default",
    "contractRef": "services/bci-pyme/docs/contracts/read-only-browser-flow.md#observed-flow",
    "contractVersion": "2026-09-14",
    "safeToRetry": false,
    "loginAttempted": false,
    "remoteMutationPossible": false,
    "validation": [{ "field": "--business-id", "expected": "discovered business ID", "discoverWith": "portales bci-pyme businesses list --profile default" }]
  }
}
```

`reason`, `stage`, and `nextAction` are static tokens or sentences, never portal text. `validation` appears only on `INVALID_INPUT` and names the exact discovery command. `activeRunId` appears on `RUN_LOCKED`.

### Lifecycle events (STDERR JSONL)

Every service command emits one line per stage, all sharing the run's `runId`:

```json
{"schemaVersion":"1","runId":"run_…","service":"bci-pyme","operation":"cartolas.download","stage":"navigate","at":"2026-09-17T12:00:01.000Z","elapsedMs":1200,"browserMode":"headed-xvfb"}
```

Stages are exactly `preflight`, `session-check`, `navigate`, `parse`, `download`, `verify`, then `completed` or `failed` (with the error code as `detail`). Task-specific progress uses the same shape with a static `detail`. Global commands emit no events.

### Exit codes

- `0`: success
- `1`: unexpected/internal failure, browser launch failure, stale build
- `2`: invalid input, missing local dependency, expired or stale snapshot, unsupported capability
- `3`: not authenticated or session expired
- `4`: login failed, additional authentication required, credentials or keyring problem
- `5`: authorization denied
- `6`: rate limited or account blocked (including a tripped login breaker)
- `7`: contract mismatch, download validation failure, ambiguous remote state
- `8`: confirmation required or mismatched
- `9`: provider error page or readiness timeout
- `10`: another run holds the service/profile lock

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

One cross-service taxonomy (`packages/runtime/src/errors.ts`). Every code carries default recovery metadata; tasks refine `stage`, `reason`, `nextCommand`, and `contractRef`.

| Code | Meaning |
| --- | --- |
| `INVALID_INPUT` | Local input problem; `validation[]` names field, constraint, and discovery command. |
| `CONFIRMATION_REQUIRED` | Missing or mismatched operation-specific `--confirm`. |
| `CREDENTIALS_NOT_CONFIGURED`, `CREDENTIALS_INVALID` | Keyring bundle missing or malformed. |
| `KEYRING_LOCKED`, `KEYRING_UNAVAILABLE` | Secret Service denied or unreachable. |
| `LOGIN_FAILED`, `ADDITIONAL_AUTH_REQUIRED` | Explicit login stopped; never retried automatically. |
| `NOT_AUTHENTICATED`, `SESSION_EXPIRED` | No usable session; run the explicit login. |
| `AUTHORIZATION_DENIED` | The account lacks permission. |
| `RATE_LIMITED`, `ACCOUNT_BLOCKED` | Provider-side stop, including a tripped login breaker. |
| `LOCAL_DEPENDENCY_MISSING` | Chrome, Xvfb, pdftotext, or another local tool is absent. |
| `BROWSER_LAUNCH_FAILED` | The browser or virtual display could not start. |
| `PROVIDER_ERROR` | The portal served an error page or was unreachable. |
| `READINESS_TIMEOUT` | The expected page state did not appear in time. |
| `CONTRACT_MISMATCH` | The page structure differs from the dated contract; `PORTAL_CHANGED` is a legacy alias. |
| `DOWNLOAD_INVALID` | Downloaded bytes failed signature, structure, or identity validation. |
| `REMOTE_STATE_AMBIGUOUS` | A write may have happened; reconcile with a read, never resubmit. |
| `RUN_LOCKED` | Another run holds this service/profile; `activeRunId` names it. |
| `SNAPSHOT_EXPIRED`, `SNAPSHOT_STALE` | A prepare snapshot is too old or the portal/account state changed. |
| `UNSUPPORTED_CAPABILITY` | The operation exists in the catalog but is not implemented for this branch. |
| `STALE_BUILD` | The executable does not match the checkout. |
| `INTERNAL` | Unexpected failure; the message is static and the cause stays in the private run record. |

Provider messages may be attached after redaction. Preserve an authoritative Spanish portal message when translation would make it less useful. Never label a deterministic portal change as retryable, and never report `CONTRACT_MISMATCH` for a local, transport, or provider failure.

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
