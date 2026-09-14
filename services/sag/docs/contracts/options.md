# Public catalog discovery — observed 2026-09-14

## Evidence and boundary

Headed browser navigation to `https://dj.sag.gob.cl/declaracion-jurada` showed
the SAG declaration title and an initial nationality picker. Opening the picker
showed the complete country list with radio controls and a search field.
No authentication or traveler information was needed for catalog requests.

The browser network recorded an unexpected `POST /declaracionJurada/` creating
an empty draft during discovery, before traveler details were entered. Its
response had empty stages and no finalized declaration marker. Investigation
stopped advancing the form. No draft identifier or response is retained here.
Never assume loading or advancing this application is read-only.

## Observed requests

The initial application loaded these GETs from `https://djapi.sag.gob.cl`:

| Path | Shape of each `data` item |
| --- | --- |
| `/paises` | `id`, `nombreEsp`, translated names, `idioma` |
| `/generos` | same named-option shape |
| `/documentosViaje` | same named-option shape |
| `/tiposControlFronterizo` | same named-option shape |
| `/tiposTransportes` | named-option shape plus unused provider metadata |
| `/controlesFronterizos` | `id`, `nombre`, `estaActivo`, `tipoControlFronterizoId`, unused location/declaration metadata |
| `/controlesFronterizos/controlFronterizoTipoTransporte` | `controlFronterizoId`, `tipoTransporteId` |

Responses were HTTP 200 JSON with `{status: 200, data: [...], msg: {...}}`.
IDs were numeric. Requests had no body or authorization header; browser-managed
origin/referer and JSON accept headers were present. Cookies are browser-managed
and are neither copied into requests manually nor persisted.

The loaded `main.4980f562270a251b.js` defines the catalog loading and the
border-control-to-transport index. The loaded `9007.b1c5c25f565af872.js` reads
travel documents and entry modes, filters border controls by `estaActivo`,
selects controls by `tipoControlFronterizoId`, and obtains transport choices for
the chosen control. These are structural source observations; later form stages
were not completed. No unobserved filtered endpoint is replayed.

## Implementation and success

Replay is within a fresh browser context at the observed document origin, with
page JavaScript disabled and service workers blocked. An exact request allowlist
permits only the document and the seven catalog URLs, using GET. All other
requests, including application writes and redirects to other URLs, are blocked.
The adapter reads catalogs sequentially with a bounded timeout and no retries.

Success requires the expected document URL/title, seven successful JSON
envelopes, nonempty catalogs, unique IDs, and valid references between catalogs.
Only IDs, trimmed labels, and parent relationships cross the portal boundary. Disabled
controls are omitted. Duplicate labels are preserved under distinct IDs.
No hardcoded catalog contents or counts are used for validation.

`options` returns every supported reference catalog. Origin excludes Chile after
the travel picker observation recorded in [the preparation contract](declaration.md).
Authentication, minors-luggage, and SAG-product choices come from the observed
form controls. Arrival-date groups use each control's `diasAnticipacion` and the
current America/Santiago day; the maximum is inclusive at anticipation minus one.
Border-control groups name
their entry-mode parent; transport groups name their active border-control parent.
Arrival-date and transport groups require the border-control parent ID.
Field-specific dependent queries require the parent ID. Unknown fields, missing
parents, and extraneous arguments fail before opening a browser. Unknown parent
IDs fail against the live catalog, without submitting anything.

Stop on denial, rate limiting, invalid JSON/envelopes, missing/duplicate IDs,
dangling relationships, unexpected destinations, or document changes. Do not
retry. Diagnose locally, observe the changed boundary, then update this contract.

## Verification and fixture provenance

On 2026-09-14, `node dist/apps/cli/src/main.js sag declaracion-jurada options`
completed with exit 0 against the live portal. At the initial catalog-only stage,
every curated option and parent
relationship matched the browser application's already-loaded public IndexedDB
catalogs after trimming labels and sorting; comparison used a digest outside
the repository. No additional declaration requests were needed for comparison.
The subsequent travel-screen observation refined origin-country filtering and
added date and form choices; preview exercises those same rules against live catalogs.

The first local execution could not launch the browser inside the sandbox;
the explicitly permitted execution outside it succeeded. Browser startup failures
now report a bounded Chrome-installation/execution-permission diagnostic.

Two focused automated checks use independently synthetic values: the public CLI
preserves dependent option completeness and rejects incomplete/unsupported
commands before remote access; the request guard blocks draft creation and
all destinations outside the exact GET allowlist. These protect the observed
write hazard and the account-independent selector boundary. No broader unit
suite, browser captures, or portal payload fixtures are added.
