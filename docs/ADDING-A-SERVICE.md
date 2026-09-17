# Adding a service

Implement the smallest useful vertical slice. A service is not complete because it has folders, base classes, or a login stub.

## 1. Write the service specification

Create `services/<service>/docs/service.md` before code. Keep it concise and use this template:

```markdown
# <Service display name>

- Slug: `<service>`
- Official portal: `<url>`
- Account scope: `<what one profile represents>`
- Credential source: exact stable OS keyring service attribute and profile-to-account mapping
- Known auth factors: `<password, MFA, device approval, unknown>`
- Known lockout/rate-limit behavior: `<observed fact or unknown>`

## Intended operations

- `<resource.action>`: `<read|write|destructive>` — `<one sentence>`

## First operation

`<resource.action>` because `<why it is narrow, useful, and safe>`.

## Sensitive data

`<fields that must not be logged, committed, or exposed raw>`

## Open questions

- `<facts requiring browser observation>`
```

Unknown is an acceptable value. A guess is not.

## 2. Choose one first operation

Prefer a low-volume, read-only operation with a clear visible result. Do not begin with bulk export, money movement, tax filing, legal submission, deletion, or a framework-wide auth abstraction.

Complete when the operation has one sentence describing its value and one observable success condition.

## 3. Investigate in the browser

Follow `RESEARCH-FIRST.md`. Create a dated contract under `services/<service>/docs/contracts/`: Markdown for the explanation and a JSON fingerprint (page states, control cardinalities, frame names, readiness and stop conditions) that the adapter checks before parsing. Stop before any remote mutation.

Complete when selectors, request fields, token sources, response shape, readiness, success, and stop conditions are observed rather than inferred.

## 4. Implement the thinnest useful slice

Implement one public CLI path that produces the observable result. Reuse existing modules and add only code needed by that path. Do not create speculative abstractions, alternate interfaces, fakes, or framework layers.

## 5. Add runtime seams only after concrete need

Reuse the existing browser, keyring, session, clock, audit, and file seams. Add a seam only when the real implementation cannot proceed safely without it.

Do not extract shared portal behavior from one service. If this is the second use, compare both implementations and extract only shared knowledge with a smaller interface.

## 6. Implement the task first, then its CLI command

Build the portal operation, task boundary, and CLI route as one vertical slice. Keep the result machine-readable and the guardrails below the public command.

The CLI command is a `CommandSpec` inside the service's `ServiceSpec` (`apps/cli/src/commands/<service>.ts`), registered with one line in `apps/cli/src/registry.ts`. Declare for every command: `path`, `summary`, `effect`, `auth`, `browser`, `profile`, every positional and option (with `discoverWith` for each portal-defined value), `confirm` for writes, `output`, `errors`, `contractRef`, and `contractVersion` (the observation date). Call `context.stage(...)` at the lifecycle boundaries and `context.recordArtifact(...)` for every verified download. Help, `catalog`, `describe`, validation errors, events, and run records then come for free; do not hand-write any of them. Authenticated services expose the same `auth setup|status|login|logout|breaker status` surface.

The CLI command calls the task and nothing below it.

## 7. Test what matters

Prefer one lean end-to-end test of the public command when it catches a meaningful failure. Add unit tests only for real regressions or fragile boundaries discovered while exercising the flow. Explain when no new automated test is warranted. Preserve checks proving authentication and mutations cannot retry automatically.

## 8. Validate through the public interface

Run the supported CLI command with an explicitly selected profile. Live validation is opt-in, serialized, and makes the minimum calls. Compare the result with the visible portal.

Complete only when the public JSON result and live portal agree.

## 9. Update documentation

Add the operation to the service catalog and document sensitive output fields. Update cross-repository conventions only if the new behavior applies to more than one service.

Document how to locate existing diagnostics, distinguish likely failure boundaries, and safely verify a repair using `OPERATIONS.md`. State diagnostic limitations honestly; do not advertise unimplemented debug commands or logging.

A short decision note is needed only for a cross-cutting, surprising, security-sensitive, or costly-to-reverse choice. Normal implementation choices belong in code comments and contracts.

## Review checklist

- [ ] One narrow operation, preferably read-only
- [ ] Browser-first evidence is dated and cited
- [ ] No guessed or brute-forced requests
- [ ] Credential path is keyring-only
- [ ] Public task contains no portal or secret details
- [ ] JSON result is stable and curated
- [ ] CLI emits result once on STDOUT
- [ ] Every selector, location, account, and constrained field has an `options` command that returns the complete valid set
- [ ] Dependent option lists expose and require their parent filters
- [ ] Auth and writes are never retried automatically
- [ ] Any regression fixture is synthetic and minimal
- [ ] Tests cover the useful public path, not speculative infrastructure
- [ ] Public command was exercised and verified
