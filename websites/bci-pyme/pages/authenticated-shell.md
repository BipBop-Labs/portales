# Authenticated shell

- Status: provisional, not replay-ready
- Evidence date: 2026-09-13

## Purpose

Confirm that the browser is inside the authenticated BCI Pyme shell before any account navigation.

## Recognition evidence

Current evidence is insufficient for deterministic recognition. A safe authenticated observation must record at least two stable signals, such as a visible shell label plus an observed layout-frame or URL fragment. Absence of the login form is never sufficient.

## Available actions

Until recognition evidence is completed, the only safe action is to stop and request an observation pass.

After revalidation, expected read-only actions are:

- Open the business switcher.
- Navigate to the movements area.
- End the session.

## Runtime options

None may be guessed. Businesses are discovered from the switcher at runtime.

## Transitions

- Business selection: [Business switcher](business-switcher.md)
- Movements navigation: [Movements](movements.md)

## Stop conditions

Stop on incomplete recognition, login, Turnstile, CAPTCHA, MFA, device enrollment, access denial, session expiry, or an unknown shell.

## Related pages and flows

- [Download cartolas](../flows/download-cartolas.md)
