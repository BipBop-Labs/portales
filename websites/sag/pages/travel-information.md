# Travel information

- Status: partially observed
- Evidence date: 2026-09-13

## Purpose

Enter document and trip details using only live portal choices.

## Recognition evidence

- The Travel Information stage is visible.
- Document type, document number, country of origin, entry mode, border control, transport, and arrival date controls are present.

## Available actions

1. Enter one unconstrained private value and read it back without logging it.
2. For each constrained control, open once, recapture, discover choices, select once, and recapture to verify.
3. Select entry mode before discovering border-control and transport choices.
4. After each parent selection, recapture before reading dependent choices.
5. Open the date control once, choose the explicit private date, confirm once, and recapture to verify the displayed date.
6. Capture and verify all required controls.
7. Activate `NEXT` once and recapture the destination.

## Runtime options

Never guess airport, border control, country, transport, document type, or canonical value. Enumerate dependent options after selecting their parent.

## Transitions

- Next: [Declaration](declaration.md)
- Back: [Identification](identification.md)

## Stop conditions

Stop if dependent options do not load, the date cannot be confirmed, displayed values differ from private input, or the destination is unrecognized.

## Related pages and flows

- [Prepare a declaration](../flows/prepare-declaration.md)
