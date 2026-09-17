# Decision: prepare commands with short-lived snapshots, and one auth surface per service

- Date: 2026-09-17
- Status: accepted

## Context

A cartola download needed four commands (businesses, accounts, a temporary JSON, download), each opening a browser and rediscovering options. Authentication commands differed per service, and there was no local way to ask whether a session existed or whether a breaker was tripped without touching the portal.

## Decision

Compound reads get `prepare`: one session discovers dependent options, resolves labels or aliases only when unique, and returns normalized intent, a fingerprint and a snapshot id stored privately for 15 minutes. The final command reuses the snapshot and rejects it as `SNAPSHOT_EXPIRED` or, when re-discovered IDs differ, `SNAPSHOT_STALE` with the smallest diff. Simple single-item operations accept direct flags; `--input` remains for batches and sensitive payloads. Option catalogs are memoized within one run and never across profiles. Every authenticated service exposes `auth setup`, `auth status`, `auth login`, `auth logout` and `auth breaker status`; status and breaker status are local reads that never submit credentials, and both services keep a durable login breaker that trips when the portal rejected submitted credentials and is never reset automatically.

## Alternatives

- Cache option catalogs across runs: rejected; account context can change and stale IDs would be submitted.
- Let the download command resolve labels itself: rejected; a non-unique label resolution must fail before a browser opens, and the fingerprint must be reviewable.
- Reuse SII's session-only model for BCI: rejected; BCI needs the breaker and the explicit one-attempt login.

## Consequences

Snapshots contain only IDs and labels already returned by discovery commands, never cookies. Direct flags and `--input` are mutually exclusive. SII entity-scoped operations take `--empresa` only (the former `--rut` override was removed rather than aliased); principal-only operations report `supportedScopes` and the authenticated principal.
