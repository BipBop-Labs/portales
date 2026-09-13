# Agent guide

This repository is designed to be changed by coding agents without sacrificing account safety or interface consistency.

## Read before changing anything

1. `docs/ARCHITECTURE.md`
2. `docs/RESEARCH-FIRST.md`
3. `docs/CONVENTIONS.md`
4. `docs/SECURITY.md`
5. `docs/ADDING-A-SERVICE.md`
6. The target service's `services/<service>/docs/service.md` and contracts, when they exist

For design work, use the `ousterhout-software-design` skill from [`BipBop-Labs/bipbop-skills`](https://github.com/BipBop-Labs/bipbop-skills). Prefer deep modules, information hiding, obvious interfaces, and pulling unavoidable complexity below the task boundary.

## Non-negotiable rules

- Navigate first. Observe the exact operation in a real browser before implementing selectors or request replay.
- Never guess, enumerate, fuzz, or brute-force private endpoints, form fields, selectors, tokens, or identifiers.
- Never automatically retry authentication, CAPTCHA, authorization failures, account blocks, rate limits, or mutations.
- Read credentials only through the shared OS-keyring seam. No public task, CLI argument, environment variable, config file, log, or fixture may carry a password, PIN, token, or one-time code.
- Tasks do not log in as a side effect. Authentication is an explicit operation.
- The CLI calls service tasks only. It does not import portal modules or reproduce guardrails.
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

## Design discipline

Before adding a public task, write its caller-facing comment and sketch two materially different interfaces. Choose the one with:

- the least information a caller must know;
- the fewest parameters and special cases;
- the strongest guardrails below the interface;
- the most JSON-obvious result;
- the easiest fake-backed test.

Do not commit the sketches unless the choice is costly to reverse or surprising. In that case, add one short decision note under `docs/decisions/`.

Do not extract a shared abstraction from one service. The second real use must demonstrate that the abstraction removes more complexity than it adds.

## Completion criteria

A portal operation is not complete until:

- its observed flow and contract are dated and documented;
- its task is tested with fakes or sanitized fixtures;
- CLI JSON behavior is tested;
- authentication, rate-limit, portal-change, and effect-specific failure paths are covered;
- the supported public command was exercised;
- any live validation was explicitly enabled, minimal, and verified against portal state.
