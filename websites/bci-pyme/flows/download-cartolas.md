# Download cartolas

- Name: `bci-pyme cartolas download`
- Effect: `read` remotely, private file write locally
- Authentication: pre-established session required
- Status: draft, blocked on authenticated deterministic replay
- Evidence date: 2026-09-13

## Private input

Selection scope (`all businesses` or chosen private aliases), account scope, date range, and desired visible export format.

## Steps

1. Recognize the [authenticated shell](../pages/authenticated-shell.md). Stop while that page card remains not replay-ready.
2. Open the [business switcher](../pages/business-switcher.md) and enumerate the complete current set.
3. For each selected business, either select a different choice once and verify the exact change, or keep the already-active choice without reselecting it.
4. Open [Movements](../pages/movements.md).
5. Enumerate eligible accounts and date/document options from visible controls.
6. For each selected account, verify business, account, and date immediately before opening the [download menu](../pages/download-menu.md).
7. Trigger one read-only download and wait for exactly one download event.
8. Save to a private random filename with mode `0600`. Validate content type and PDF/XLSX/CSV signature; reject HTML.
9. Continue serially. Never overlap businesses, accounts, or downloads.

## Output

Return private descriptors only: opaque business/account aliases, path, media type, byte count, checksum, and per-item status. Do not return document contents or provider filenames.

## Verification

The run is complete only when every requested alias has exactly one validated descriptor or an explicit failure. A partial result is not silently retried.

## Stop and recovery

On uncertain action, recapture before deciding. Never duplicate the action. Stop the entire run on authentication, unknown frames, multiple downloads, changed controls, or ambiguous state. Resume only from a newly recognized checkpoint in a separately authorized run.
