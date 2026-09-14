# Movements

- Status: provisional, not replay-ready
- Evidence date: 2026-09-13

## Purpose

Reach the read-only account movements view and discover eligible accounts.

## Recognition evidence

- Visible text includes `Mis Movimientos`.
- The movements microfrontend appears within the authenticated shell.
- Account and date controls are visible before download actions.

Earlier evidence suggests nested layout, dashboard, and movements frames. Their exact stable identity must be recorded during an authenticated browser observation before this card is replay-ready.

## Available actions

1. Capture the recognized movements state.
2. Open the account control once.
3. Recapture and enumerate current choices.
4. Select one account once.
5. Recapture and verify the displayed account privately.
6. Discover visible date and document controls.
7. Open `Descargar` once.
8. Recapture and recognize the [Download menu](download-menu.md).

## Runtime options

Accounts, date ranges, and document formats must be read from current visible controls. Use private aliases; never guess or reuse stale IDs.

## Transitions

- Open download choices: [Download menu](download-menu.md)
- Change business: [Business switcher](business-switcher.md)

## Stop conditions

Stop if `Mis Movimientos` cannot be recognized, frame identity remains ambiguous, the selected business or account is ambiguous, controls are incomplete, or the view offers a write action.

## Related pages and flows

- [Download cartolas](../flows/download-cartolas.md)
