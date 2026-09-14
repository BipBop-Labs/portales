# Business switcher

- Status: provisional
- Evidence date: 2026-09-13

## Purpose

Discover the complete set of businesses available to the authenticated profile and select one at a time.

## Recognition evidence

- A visible control identifies the active business.
- Opening it reveals selectable business choices.
- The authenticated shell remains recognizable.

These signals require authenticated browser revalidation.

## Available actions

1. Capture and note the active choice privately.
2. Open the switcher once.
3. Recapture and enumerate all visible choices.
4. Assign private opaque aliases in display order.
5. Select one choice once, or close without selection.
6. Recapture before any further action.

## Runtime options

Every choice comes from the live switcher. Never infer businesses from previous runs or labels elsewhere on the page. Keep labels and portal identifiers only in private run state.

## Transitions

- If a different business was selected, verify that the active-business evidence changed to that exact choice.
- If the already-active business is the target, close without reselection and verify that its evidence remains unchanged.
- Continue to [Movements](movements.md).

## Stop conditions

Stop if choices are truncated, duplicated ambiguously, hidden behind authorization, or selection causes a login or device-registration flow.

## Related pages and flows

- [Authenticated shell](authenticated-shell.md)
- [Download cartolas](../flows/download-cartolas.md)
