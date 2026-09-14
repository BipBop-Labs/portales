# Start and nationality

- Status: observed
- Evidence date: 2026-09-13

## Purpose

Discover nationality choices and complete the first anonymous declaration page.

## Recognition evidence

- The digital entry declaration title is visible.
- A nationality selector and `NEXT` action are present.
- The anonymous route has already been selected.

## Available actions

1. Capture and recognize this page.
2. Open nationality choices once.
3. Recapture and enumerate all current choices.
4. Select the requested choice once.
5. Recapture and verify the selected nationality.
6. If a residence-in-Chile question appears, recapture, answer it from explicit private input once, and recapture again.
7. Activate `NEXT` once.
8. Recapture and recognize the destination.

## Runtime options

Use the live nationality list. Answer residence only from explicit private input.

## Transitions

- Next: [Identification](identification.md)
- Back: [Entry route](entry-route.md)

## Stop conditions

Stop on unexpected authentication, CAPTCHA, missing selection state, altered questions, or an unrecognized destination.

## Related pages and flows

- [Prepare a declaration](../flows/prepare-declaration.md)
