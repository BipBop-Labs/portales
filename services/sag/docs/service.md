# SAG digital entry declaration

- Slug: `sag`
- Official portal: https://dj.sag.gob.cl/declaracion-jurada
- Account scope: public reference catalogs; no traveler or profile is required.
- Credential source: none for the supported public operation; no keyring namespace is used.
- Authentication factors and lockout/rate limits: unknown; no login is implemented.

## Supported operation

`declaracion-jurada.options` (`read`, public) returns live country, gender,
travel-document, entry-mode, active border-control, and transport catalogs.
It also exposes arrival dates by control, gender, authentication choices, minors'
luggage, and SAG product answers. Origin country excludes Chile.
This is the first operation because it lets callers discover complete IDs and
dependencies without entering traveler data or creating a declaration.

```sh
portales sag declaracion-jurada options
portales sag declaracion-jurada options nationality
portales sag declaracion-jurada options entry-mode
portales sag declaracion-jurada options border-control --entry-mode <discovered-id>
portales sag declaracion-jurada options transport-type --border-control <discovered-id>
portales sag declaracion-jurada options arrival-date --border-control <discovered-id>
portales sag declaracion-jurada preview --input <private-json-file>
portales sag declaracion-jurada download --input <private-receipt-json> --output <new-private-pdf>
portales sag declaracion-jurada --help
```

No field returns all supported catalogs, including separate groups for each
parent selection. IDs are strings; labels are Spanish. `--human` pretty-prints
the same result. Options and preview fetch the seven catalogs once, sequentially.

`declaracion-jurada.download` (`read`, public) retrieves an already-finalized
declaration by its exact final folio and unique identifier. It verifies MIME,
signature, and labeled PDF fields before publishing a new file in a private
directory outside any repository. The current receipt layout is English;
other layouts stop with `PORTAL_CHANGED`. Install `pdftotext` for verification.
See [the receipt contract](contracts/receipt.md). It never presents a declaration.

`declaracion-jurada.preview` (`read`, public) validates a private JSON intent using
the same catalogs and parent rules, then returns normalized fields, labels, and
a confirmation fingerprint. It creates no draft. Its current scope is a Chilean
adult using a Chilean identity document, without ClaveÚnica or minors' luggage,
at a SAG-only control. See [the observed preparation contract](contracts/declaration.md).
Use `preview --help` for the input fields. Dates use `YYYY-MM-DD` and the
America/Santiago calendar. All selector IDs, including yes/no answers, are strings.

## Safety and limitations

The portal was observed creating an empty remote draft during initial browser
discovery. The adapter disables page scripts and service workers and permits only
the document GET and the seven observed catalog GETs. It never advances the form,
restores sessions, authenticates, creates, edits, or submits a declaration.

Preview checks the observed branch only and does not replace the portal's final
validation. Authentication, other form branches, and automatic submission remain
unimplemented. One real declaration was finalized through the observed browser
flow after explicit confirmation, and its receipt was retrieved through the CLI.

## Sensitive data

Options output contains only public catalog IDs, labels, and relationships.
Preview output contains the supplied traveler and trip details: retain it privately
outside the repository and never put it in diagnostics or fixtures.
Traveler identity, contact details, itinerary, declaration contents, draft IDs,
folios, cookies, and browser storage must never enter logs or repository files.
No live payloads or fixtures are packaged.

## Diagnostics and recovery

See [the dated contract](contracts/options.md) and
[operations guidance](../../../../docs/OPERATIONS.md).
Errors are bounded JSON on STDERR: invalid arguments use `INVALID_INPUT`,
denials use `AUTHORIZATION_DENIED`, rate limits use `RATE_LIMITED`, and changed
schemas, redirects, missing catalogs, or browser failures use `PORTAL_CHANGED`.
No automatic retries occur. Correct local inputs before execution; observe and
repair changed contracts before another live attempt. There is no persistent log.

Build with `npm run build`; live verification uses the public `options` command.
Chrome must be installed for Playwright's `chrome` channel.
