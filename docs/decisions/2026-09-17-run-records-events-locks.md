# Decision: private run records, JSONL lifecycle events and per-profile locks

- Date: 2026-09-17
- Status: accepted

## Context

After a failure there was no history: no run identifier, no stage timing, no way to know whether a cron job and an interactive command had shared a browser session. `OPERATIONS.md` explicitly warned that no diagnostic history existed.

## Decision

Every service command gets a `runId`. The runner emits static-stage JSONL events on STDERR (`preflight`, `session-check`, `navigate`, `parse`, `download`, `verify`, `completed`, `failed`) sharing that `runId`, and writes a bounded record under `$XDG_STATE_HOME/portales/runs/` (mode 0600, newest 200 kept) with stage timings, typed error and recovery, contract version, browser mode and artifact descriptors. Records never contain credentials, cookies, HTML, bodies, messages with portal text or account data. Browser-backed commands acquire a per-service/profile lock; a concurrent run receives `RUN_LOCKED` with the active `runId`. `portales runs list|show` expose the records; `portales contract check <run-id>` builds on them.

## Alternatives

- A logging framework or telemetry service: rejected; no operational requirement and a privacy surface.
- Full browser traces on failure: rejected; they contain account data and would be tempting to attach to issues.
- Global lock instead of per-profile: rejected; unrelated profiles and public services should not serialize.

## Consequences

Global commands (`catalog`, `version`, ...) emit no events and no records. A failure to write a record never changes the outcome of the operation. Locks are keyed by the process id and are reclaimed when the holder is dead.
