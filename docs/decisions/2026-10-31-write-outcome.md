# Decision: write outcome on every session write error

- Date: 2026-10-31
- Status: accepted

## Context

`REMOTE_STATE_AMBIGUOUS` defaulted to `remoteMutationPossible: true`, but several BCI throw sites used it for state checks that ran before any submission. Two real paths had the opposite problem: a sent write whose verification read failed surfaced as that read's code with `remoteMutationPossible: false`. These were BCI recipient read-back, an SII borrador POST that SII did not confirm, and a BCI session expiry after the authorization click. An agent could not tell from the envelope whether a write had left. The idea of a closed outcome set came from `goodnight000/api-anything`, which reports `not_sent`, `not_applied`, `accepted`, `applied` and `may_have_applied` for each write.

## Decision

`RecoveryMetadata.writeOutcome` is `not-sent`, `rejected` or `may-have-applied`. The runner adds it to every error of a `write` or `destructive` command with `auth: session` and strips it elsewhere. A throw site that states an outcome also decides `remoteMutationPossible`; otherwise the runner derives the outcome from that boolean. Write tasks wrap everything from the submitting request through the verification read, so failures there become `REMOTE_STATE_AMBIGUOUS`. A portal refusal that kept nothing is `rejected` (SII's borrador alert maps to `INVALID_INPUT`).

## Alternatives

- Re-code the pre-submission cases and keep only the boolean: rejected. It fixes the wrong sites but gives the agent no field to branch on and no `rejected` case.
- Copy api-anything's 10-minute duplicate-write refusal: rejected. SII writes already consume their prepare snapshot before submitting, and BCI writes re-read the recipient list and turn a repeat into `already-exists`. A third guard would cover the same risk.
- Add `accepted` and `applied`: rejected. Every write here verifies live state before succeeding, so success is the result and no write reports "sent but unverified" as success.

## Consequences

A new write task must mark its submission boundary; the runner cannot know it. `not-sent` from derivation is only as correct as that boundary. An expired session bounced before a POST is still reported `may-have-applied`; that is the conservative error.
