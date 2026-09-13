# Adding a service

Implement the smallest useful vertical slice. A service is not complete because it has folders, base classes, or a login stub.

## 1. Write the service specification

Create `services/<service>/docs/service.md` before code. Keep it concise and use this template:

```markdown
# <Service display name>

- Slug: `<service>`
- Official portal: `<url>`
- Account scope: `<what one profile represents>`
- Credential source: OS keyring service `cl.bipbop.portales.<service>`
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

Follow `RESEARCH-FIRST.md`. Create a dated contract under `services/<service>/docs/contracts/`. Stop before any remote mutation.

Complete when selectors, request fields, token sources, response shape, readiness, success, and stop conditions are observed rather than inferred.

## 4. Design the task twice

Write the public comment and sketch two materially different task interfaces. Compare caller knowledge, parameter count, hidden complexity, failure surface, and testability. Keep the simpler deep interface.

Examples of different designs include:

- one task returning a complete result versus a sequence that leaks session steps;
- domain parameters versus raw form fields;
- one paginated iterator versus page-number plumbing at every caller.

Do not create extra public methods merely to make each method shorter.

Complete when the chosen task can be explained fully without exposing portal implementation details.

## 5. Add only needed runtime seams

Reuse the existing browser, keyring, session, clock, audit, and file seams. Add a seam only for a volatile dependency or a guardrail that cannot otherwise be tested.

Do not extract shared portal behavior from one service. If this is the second use, compare both implementations and extract only shared knowledge with a smaller interface.

## 6. Implement the task first, then its CLI command

Build in this order:

1. boundary schema and typed result;
2. portal adapter against sanitized fixtures/fakes;
3. task policy and typed errors;
4. CLI command and JSON contract.

The CLI command calls the task and nothing below it.

## 7. Test failure paths

At minimum cover invalid input, missing credentials/session, session expiry, provider error, rate limit/block, changed portal shape, and the operation's effect-specific guardrails. Login tests assert one attempt. Mutation tests assert no automatic retry and live-state verification.

## 8. Validate through the public interface

Run the supported CLI command with an explicitly selected profile. Live validation is opt-in, serialized, and makes the minimum calls. Compare the result with the visible portal.

Complete only when the public JSON result and live portal agree.

## 9. Update documentation

Add the operation to the service catalog and document sensitive output fields. Update cross-repository conventions only if the new behavior applies to more than one service.

A short decision note is needed only for a cross-cutting, surprising, security-sensitive, or costly-to-reverse choice. Normal implementation choices belong in code comments and contracts.

## Review checklist

- [ ] One narrow operation, preferably read-only
- [ ] Browser-first evidence is dated and cited
- [ ] No guessed or brute-forced requests
- [ ] Credential path is keyring-only
- [ ] Public task contains no portal or secret details
- [ ] JSON result is stable and curated
- [ ] CLI emits result once on STDOUT
- [ ] Auth and writes are never retried automatically
- [ ] Fixtures are synthetic and sanitized
- [ ] Portal-change and account-block behavior stop safely
- [ ] Public command was exercised and verified
