# Final review

- Status: observed
- Evidence date: 2026-09-13

## Purpose

Verify the prepared declaration and enforce the irreversible boundary.

## Recognition evidence

- The final review is visible.
- `I Declare` is visible as the final control.
- No terminal reference or receipt exists yet.

## Available actions

- Review displayed values privately.
- Stop and report ready for authorization.
- Follow the separate [submission flow](../flows/submit-declaration.md) only after immediate exact authorization.

## Runtime options

No value may be corrected by assumption. Navigate back if private input and display disagree.

## Transitions

- Back to an earlier page for explicit correction.
- After authorized submission only: [Terminal success](success.md).

## Stop conditions

Without immediate authorization, stop before `I Declare`. After activation, never retry on ambiguity.

## Related pages and flows

- [Prepare a declaration](../flows/prepare-declaration.md)
- [Submit a reviewed declaration](../flows/submit-declaration.md)
