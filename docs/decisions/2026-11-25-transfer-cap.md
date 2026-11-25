# Decision: money-moving commands need an owner-set local cap

- Date: 2026-11-25
- Status: accepted

## Context

`bancochile-personas transferencias create` is the first command in this repository that moves money, and agents are expected to call it. The confirmation code comes from `prepare`, which any agent can run, so it binds the exact order but does not involve a person. The bank's own second factor (Mi Pass) was requested in every observed transfer. However, its challenge answer carries a risk score (`score`, `categoria`, `tieneCajaDesafio`), so the bank appears to decide per operation, after `CONFIRMAR`, whether to ask. Nothing in the adapter can stop a transfer that the bank completes without a challenge.

## Decision

A money-moving command reads a per-service cap from a private config file outside the repository: `$XDG_CONFIG_HOME/portales/<service>.json`, mode `0600`, set by the account owner. The cap is checked before any browser opens and again inside the task. A missing, malformed, or group/other-writable file fails closed with `INVALID_INPUT`. An amount above the cap is refused, and the error says not to split the transfer. The bank's second factor remains the human approval; the cap bounds the damage when the bank does not ask for it.

## Alternatives

- Rely only on the bank's second factor: rejected. It is risk-based, and nothing tells us its rules.
- A cap constant in the repository: rejected. The limit belongs to the account owner, not to every user of the code, and a default would apply silently.
- Require an interactive terminal for `create`: rejected for now. It would remove the agent use case; the owner already approves each challenge on the phone.

## Consequences

Any future payment or transfer command in another service follows the same rule with its own file. The cap protects against agent mistakes and wrong amounts. It does not protect against an agent that can edit files on the host where it runs; that isolation is a deployment concern. Recipient changes without a second factor (`favorite`, `delete-account`) are not covered by this rule.
