# Agent guide

This repository is designed to be changed by coding agents without sacrificing account safety or interface consistency.

Portales is the agent's maintained operations adapter. Using a service, diagnosing a failure, repairing its adapter, and verifying the result belong to the same working loop. The agent using the tool owns that loop through completion; delegating implementation does not transfer responsibility for the real result.

Build a reusable interface through actual use. Before interacting with an external service, look for its existing public command. Extend that command or add the smallest useful operation when the current task needs it. Browser investigation and temporary scripts may establish the flow, but a recurring capability belongs in the maintained CLI with its observed contract. Each completed task should leave the next agent able to reuse the capability without rediscovering portal internals. Let current needs drive the service catalog; do not implement a roadmap of hypothetical integrations.

Explore before building. Read the existing command, service implementation, conventions, and observed contract; then investigate the exact real flow and understand the failure or missing behavior. Implement only after that evidence explains what must change. Follow the repository's existing patterns and extend its interfaces. Speed comes from a narrow understood change, never brute force, guessed requests, blind retries, or a parallel implementation that bypasses conventions.

## Read before changing anything

1. `docs/ARCHITECTURE.md`
2. `docs/RESEARCH-FIRST.md`
3. `docs/CONVENTIONS.md`
4. `docs/SECURITY.md`
5. `docs/KEYRING.md`
6. `docs/ADDING-A-SERVICE.md`
7. The target service's `services/<service>/docs/service.md` and contracts, when they exist
8. `docs/OPERATIONS.md` for execution, diagnostics, and repair

For design work, use the `ousterhout-software-design` skill from [`BipBop-Labs/bipbop-skills`](https://github.com/BipBop-Labs/bipbop-skills). Prefer deep modules, information hiding, obvious interfaces, and pulling unavoidable complexity below the task boundary.

## Non-negotiable rules

- Navigate first. Observe the exact operation in a real browser before implementing selectors or request replay.
- Never guess, enumerate, fuzz, or brute-force private endpoints, form fields, selectors, tokens, or identifiers.
- Never automatically retry authentication, CAPTCHA, authorization failures, account blocks, rate limits, or mutations.
- Read credentials only through the shared OS-keyring seam. No public task, CLI argument, environment variable, config file, log, or fixture may carry a password, PIN, token, or one-time code.
- Tasks do not log in as a side effect. Authentication is an explicit operation.
- The CLI calls service tasks only. It does not import portal modules or reproduce guardrails.
- Every portal-defined selector must be discoverable through an explicit CLI `options` command. Never require an agent to guess a value, scrape `--help`, or know a portal label in advance.
- Keep STDOUT machine-readable. Diagnostics belong on STDERR.
- Treat writes as previewable when possible. Irreversible actions require explicit, operation-specific confirmation and live post-write verification.
- Tests never touch a production portal or the real keyring by default.
- Never copy data supplied by a user, a live portal, chat, email, document, screenshot, or local account into this repository. This includes examples, fixtures, snapshots, traces, issues, comments, and commit messages.
- Create examples and fixtures from scratch with obviously synthetic identities and values. Never make a fixture by partially masking live data. Remove cookies, RUTs, account numbers, names, addresses, client names, emails, phone numbers, amounts, document contents, and hidden fields that can identify an account.
- If the portal behaves differently from the recorded contract, stop with a `PORTAL_CHANGED` error. Do not add retries.

## Mandatory public-repository gate

Before every commit and again before every push:

1. Inspect every staged filename and the complete staged diff.
2. Search staged content for emails, RUTs, phone numbers, addresses, personal and client names, account/card numbers, credentials, cookies, tokens, balances, transaction descriptions, and document text.
3. Confirm examples and fixtures were authored as synthetic data rather than derived from a live source.
4. Confirm screenshots, HAR files, browser traces, downloads, session files, and copied portal payloads are absent.
5. If any value's provenance is uncertain, remove it. Do not push first and clean history later.

Completion means the staged tree contains no user, client, or live-account data and this has been checked after the final edit.

## Delivery discipline

Prioritize the operation needed now, the smallest safe repair, and evidence that it works in the real environment. Do not add unrelated features, speculative extensibility, or test infrastructure while fixing an operation.

When a command fails, follow `docs/OPERATIONS.md`: inspect the existing error and local evidence, identify the failed boundary, observe changed portal behavior when needed, repair the adapter, and verify through the public CLI. A stop condition stops portal execution, not safe local diagnosis. Resume remote work only when its safety boundary permits it.

Make failures diagnosable with bounded, allowlisted context and a concrete next step. Keep operational logs outside the repository. Record reusable structural findings in the service contract, never account data or raw logs.

Start with the real user-visible operation and the smallest implementation that can exercise it through the public CLI. Do not create seams, fakes, schemas, framework layers, or alternate interface sketches before the real flow demonstrates that they are needed.

Prefer one readable end-to-end test of the public command when it earns its maintenance cost. Add a unit test only after a real regression or a specific fragile boundary has been identified; the test must name that behavior. Zero new tests is valid when no meaningful automated check is justified. Do not build speculative test infrastructure, chase coverage percentages, or mirror third-party suites. Keep checks protecting authentication, account scope, secrets, and single execution of writes.

Do not extract a shared abstraction from one service. The second real use must demonstrate that the abstraction removes more complexity than it adds.

## Completion criteria

A portal operation is not complete until:

- its observed flow and contract are dated and documented;
- the supported public command was exercised against the real portal;
- its result was verified against observable portal state;
- automated tests are limited to useful public paths, real regressions, and identified safety boundaries; explain when no new test is warranted;
- unit tests exist only for regressions or fragile pure boundaries already encountered;
- authentication and writes remain explicit, bounded, and never automatically retried;
- failures have a documented diagnostic and recovery path;
- any unavailable live verification is reported as pending, never replaced by a claim based on passing mocks.
