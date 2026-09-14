# Download menu

## Purpose

Choose a read-only cartola export and verify that exactly one download begins.

## Recognition evidence

- The current business and account were verified immediately beforehand.
- The `Descargar` menu is open.
- A detailed export option such as `Descargar excel detallado` is visible.

The labels above are provisional observations dated 2026-09-13.

## Available actions

- Choose one documented read-only export option once.
- Cancel the menu.

## Runtime options

Use only visible export choices. Do not infer formats from filenames or hidden requests.

## Transitions

A successful action produces one browser download event and remains within the read-only movements context.

## Stop conditions

Stop if no download event appears, multiple downloads begin, the response is HTML, the menu changes, or any confirmation resembles a payment, transfer, enrollment, or approval.

## Related pages and flows

- [Movements](movements.md)
- [Download cartolas](../flows/download-cartolas.md)
