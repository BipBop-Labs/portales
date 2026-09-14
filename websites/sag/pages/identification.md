# Identification

- Status: observed
- Evidence date: 2026-09-13

## Purpose

Enter traveler identity details without exposing them in diagnostics.

## Recognition evidence

- The Identification stage is visible.
- Name, email, gender, and accompanying-minor controls are present.

## Available actions

For each field, use a fresh capture when controls change:

1. Enter one private text value, then read it back without logging it.
2. For a constrained control, open it once, recapture, discover choices, select once, and recapture to verify.
3. After all fields, capture and verify that required controls are valid.
4. Activate `NEXT` once.
5. Recapture and recognize the destination.

## Runtime options

Never infer identity, gender, residence, or minors' luggage. Do not place values in logs, screenshots, or errors.

## Transitions

- Next: [Travel information](travel-information.md)
- Back: [Start and nationality](start.md)

## Stop conditions

Stop if validation fails, a control is missing, selected values cannot be read back, or the destination is unrecognized.

## Related pages and flows

- [Prepare a declaration](../flows/prepare-declaration.md)
