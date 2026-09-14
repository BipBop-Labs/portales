# BCI Pyme agent instructions

Read this file before interacting with BCI Pyme.

- Documentation status: provisional map
- Structural evidence date: 2026-09-13
- Deterministic browser-use replay: not yet completed

Do not treat provisional page cards as authorization to improvise. A future authenticated observation must replace generic evidence before the flow is marked replayable.

## Scope

Supported intent: discover available businesses and accounts, inspect movements, and download cartolas. All supported remote actions are read-only.

Never enter transfers, payments, beneficiaries, approvals, device enrollment, administration, or any other write area.

## Authentication boundary

Begin only from an already authenticated browser profile. The agent must not type or receive credentials. If a login page, Cloudflare/Turnstile, CAPTCHA, MFA, device-registration prompt, session-expiry notice, or account block appears, stop the entire run. Do not retry.

## Deterministic loop

Capture, recognize the current page, perform one documented action, recapture, and verify the transition. Use fresh references after every state change.

## Flows

- [Download cartolas for available businesses](flows/download-cartolas.md)

## Pages

- [Authenticated shell](pages/authenticated-shell.md)
- [Business switcher](pages/business-switcher.md)
- [Movements](pages/movements.md)
- [Download menu](pages/download-menu.md)

## Private runtime data

Business labels, account labels, identifiers, balances, movements, and downloaded documents remain private. Use opaque aliases such as `business-1` only in private run state. Never paste runtime values into this repository, logs, or reports.
