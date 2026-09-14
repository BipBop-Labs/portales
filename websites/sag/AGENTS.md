# SAG declaration agent instructions

- Documentation status: observed but not fully replayed
- Structural evidence date: 2026-09-13
- Deterministic preparation replay: incomplete
- Submission replay: never performed

## Scope

Supported intent: prepare the anonymous digital entry declaration and, only after exact user authorization, submit it once.

## Authentication boundary

Use the anonymous `SIN CLAVE ÚNICA` route. Do not enter ClaveÚnica or another authenticated path.

## Global stop conditions

Stop on CAPTCHA, rate limiting, access denial, session expiry, device prompts, an unexpected page, ambiguous validation, or recognition evidence that differs from a page card. Never retry submission.

## Irreversible boundary

`I Declare` is a legal submission control. Preparation ends with that control visible and untouched. Submission requires immediate operation-specific authorization and exactly one activation followed by terminal-state verification.

## Flows

- [Prepare an entry declaration](flows/prepare-declaration.md)
- [Submit a reviewed declaration](flows/submit-declaration.md)

## Pages

- [Entry route](pages/entry-route.md)
- [Start and nationality](pages/start.md)
- [Identification](pages/identification.md)
- [Travel information](pages/travel-information.md)
- [Declaration](pages/declaration.md)
- [Final review](pages/final-review.md)
- [Terminal success](pages/success.md)

Traveler identity and trip values remain private runtime data and never enter this repository.
