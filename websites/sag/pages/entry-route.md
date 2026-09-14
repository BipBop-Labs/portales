# Entry route

- Status: observed
- Evidence date: 2026-09-13

## Purpose

Choose the anonymous declaration route without entering an authenticated flow.

## Recognition evidence

- Entry choices are visible.
- A control labeled `SIN CLAVE ÚNICA` is visible.
- The nationality form is not yet the active page.

## Available actions

1. Capture and recognize this page.
2. Activate `SIN CLAVE ÚNICA` once.
3. Recapture with fresh references.

## Runtime options

Only the anonymous route is supported.

## Transitions

The next page must match [Start and nationality](start.md).

## Stop conditions

Stop if the anonymous choice is absent, authentication is requested, or the destination cannot be recognized.

## Related pages and flows

- [Prepare a declaration](../flows/prepare-declaration.md)
