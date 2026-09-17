# Decision: typed failure taxonomy with bounded recovery metadata

- Date: 2026-09-17
- Status: accepted

## Context

`PORTAL_CHANGED` was returned for a missing Chrome binary, a dead network, a provider error page, an expired session that was not recognized, a bad download and a real selector change alike. An agent could not tell whether to install something, wait, re-authenticate or observe the portal, and could not tell whether a remote mutation might have happened.

## Decision

`packages/runtime/src/errors.ts` is the only error taxonomy. It distinguishes at least local dependency, browser launch, session expiry, provider error page, readiness timeout, contract mismatch, download validation and ambiguous remote state. Every error carries `stage`, `reason`, `lastCompletedStage`, `nextAction`, `nextCommand`, `contractRef`, `safeToRetry`, `loginAttempted`, `remoteMutationPossible` and `contractVersion`, with per-code defaults that a throw site may narrow. Validation errors carry `validation[]` with the field, constraint and exact discovery command. Foreign errors are mapped once at the command boundary; anything unknown is `INTERNAL` with a static message. `PORTAL_CHANGED` stays accepted as a legacy alias of `CONTRACT_MISMATCH`. Exit codes 9 (provider/readiness) and 10 (run locked) were added.

## Alternatives

- Keep one code and put the detail in the message: rejected; agents branch on codes, and messages must stay free of portal text.
- Per-service error classes crossing the CLI boundary: rejected; the SII hierarchy stays internal and is mapped.

## Consequences

Throw sites must pick the specific code and may not retry to mask it. Messages state the smallest structural expectation versus observation. Run records store code and recovery, never the message, so a message may carry a verbatim SII business rejection without leaking into private history.
