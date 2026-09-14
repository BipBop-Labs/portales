# Declaration

- Status: observed
- Evidence date: 2026-09-13

## Purpose

Record whether regulated products or goods are carried.

## Recognition evidence

- The Declaration stage is visible.
- The regulated-products question and explicit choices are present.

## Available actions

1. Capture the exact legal question and current selection state.
2. Select only the answer supplied explicitly in private input, once.
3. Recapture and verify that exact selected state.
4. Activate `NEXT` once.
5. Recapture and recognize the destination.

## Runtime options

Never infer a legal declaration from itinerary or identity data.

## Transitions

- Next: [Final review](final-review.md)
- Back: [Travel information](travel-information.md)

## Stop conditions

Stop if the question is ambiguous, altered, unanswered, cannot be verified, or the destination is unrecognized.

## Related pages and flows

- [Prepare a declaration](../flows/prepare-declaration.md)
