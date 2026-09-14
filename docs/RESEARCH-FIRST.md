# Research-first portal workflow

Portal accounts can be blocked by repeated authentication, guessed requests, or machine-speed navigation. Investigation is part of implementation, not an optional prelude.

## Core rule

**Navigate first, replay second.** Use the real supported browser flow to learn what the portal does. Never start from a guessed endpoint or a loop over possible parameters.

## Safe investigation sequence

### 1. Define one question

Choose one narrow read-only outcome, for example: “list the latest account movements” or “read the current declaration status.” Record what observable result would answer it.

Do not investigate several resources in one session. A small scope reduces requests and makes the evidence understandable.

### 2. Establish the safety boundary

Before login, identify:

- whether the operation is read, write, or destructive;
- what account/profile is in scope;
- known lockout or rate-limit behavior;
- whether CAPTCHA, MFA, one-time codes, or device approval may appear;
- the exact point after which remote state changes.

If these are unknown, stay in navigation and do not submit.

### 3. Walk the flow in a real browser

Use a headed browser and the portal's normal UI. Credentials must come from the OS keyring through the login implementation; never paste them into chat, source, shell arguments, or browser-evaluation scripts.

Capture only the evidence needed:

- start and final URL, including redirect hosts;
- page title and visible identity/account context;
- load-bearing controls and their real element types;
- the complete option set for each selector and the parent fields that change it;
- observable readiness condition;
- request/response for the single operation;
- popup, iframe, download, or client-side validation behavior;
- final success or failure marker.

Do not treat `DOMContentLoaded`, a click return, or HTTP 200 as success. Use the portal's visible state, stable URL, returned business identifier, listing, or verified artifact.

### 4. Write the observed contract

Create `services/<service>/docs/contracts/<operation>.md` with:

- portal and operation;
- observation date;
- URLs/hosts and navigation path;
- authentication and account scope;
- readiness and success conditions;
- request method, content type, required headers, body shape, and token provenance when replay is considered;
- response shape, encoding, and known error envelope;
- PII fields to curate or drop;
- stop conditions;
- sanitized fixture provenance.

Distinguish observed facts from hypotheses. Cite the page, script, or network event that proves each fragile fact.

For selectors, record where the complete list comes from and whether it is static, loaded after a parent choice, or fetched from a request. The implementation must expose that list through the CLI rather than forcing agents to repeat browser research.

### 5. Choose browser driving or request replay

Prefer browser driving when the operation depends on dynamic controls, client-side validation, popups, anti-automation state, or a short low-volume flow.

Replay a request only when DevTools observation proves its complete contract and replay materially simplifies the implementation. Replay within the authenticated browser context so cookies and browser-managed state remain consistent. Do not build a separate cookie client unless evidence proves it is needed.

Private endpoints are volatile implementation details. Keep them inside the service portal module and pair them with a dated contract and changed-shape detection.

### 6. Add evidence only when it earns its cost

Do not create a fixture by default. If a real regression exposes a fragile parser boundary, construct the smallest wholly synthetic fixture that reproduces that regression. Never transform live data into a fixture by masking it.

### 7. Implement one operation

Implement the smallest path through the public CLI. Avoid new runtime seams or abstractions until a second concrete operation needs them.

### 8. Validate minimally

A live validation must be explicitly enabled, make the minimum calls, and use the public command. Compare its result with the visible portal state. Add a lean end-to-end test for this useful path when it can run safely; add narrower tests only for regressions found during the real validation. Never validate a write using throwaway financial, tax, legal, or administrative data.

## Stop immediately when

- authentication fails or the account appears blocked;
- CAPTCHA, MFA, or device approval differs from the documented flow;
- the portal returns 401, 403, 429, an unexpected login page, or a rate-limit message;
- a selector, response schema, encoding, token source, or redirect differs from the recorded contract;
- account identity is ambiguous;
- a write response is ambiguous;
- the browser and replayed request disagree.

Return a typed, actionable error and preserve the evidence. Do not retry, broaden selectors, enumerate endpoints, or add a blind delay.

## Retry policy

- Authentication: never automatic.
- Writes and destructive actions: never automatic.
- CAPTCHA, authorization, validation, portal-change, and rate-limit failures: never.
- Reads: at most a small bounded retry for a proven transient timeout or 5xx response, with backoff and jitter through `Clock`.
- Batch reads: pace every item; an item-level business error may be reported for that item, but session-level errors abort the batch.

Throttling protects the portal. It does not repair a deterministic selector, payload, or state error.
