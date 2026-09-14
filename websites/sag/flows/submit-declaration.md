# Submit a reviewed declaration

- Name: `sag declaracion-jurada submit`
- Effect: irreversible legal submission
- Authentication: anonymous route
- Status: blocked until terminal success evidence is documented
- Evidence date: none

## Private input

Immediate authorization for the exact prepared declaration currently visible at final review. No declaration values are re-entered during submission.

## Prerequisites

- The separate [preparation flow](prepare-declaration.md) completed.
- [Final review](../pages/final-review.md) is freshly recognized.
- Every displayed value was verified privately.
- The user gave immediate, operation-specific authorization to submit this exact prepared declaration.
- [Terminal success](../pages/success.md) has verified recognition evidence. Until then, do not submit.

## Steps

1. Capture final review with fresh references.
2. Verify the exact `I Declare` control and authorization boundary.
3. Activate it exactly once.
4. Recapture without repeating the action.
5. Recognize [Terminal success](../pages/success.md).

## Output

Return only the verified private reference and validated private receipt descriptor. Never return declaration contents.

## Verification

Success requires all evidence in the terminal-success page card. A click, navigation, toast, or missing button alone is insufficient.

## Stop and recovery

After activation, any unknown, validation, timeout, or partial state is ambiguous. Stop and do not retry. Human review is required before any later action.
