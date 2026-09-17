# SII native service

- Slug: `sii`
- Location: `services/sii`
- Source of the initial implementation: selected MIT-licensed modules from [`BipBop-Labs/sii`](https://github.com/BipBop-Labs/sii)
- Runtime: the Portales npm/TypeScript toolchain

SII is compiled directly into Portales. It is not a submodule, subprocess, pnpm workspace, or separately installed CLI. `services/sii/THIRD_PARTY_LICENSE.md` preserves the original license and attribution.

Only the capabilities exercised by Portales are included:

- explicit authentication and local session status/logout;
- RCV summary, per-type list, and all-types list;
- BTE/BHE monthly listing, emission preview, and confirmed emission;
- DTE authorization lookup;
- Portal MIPYME companies, invoice drafts, previews, emitted-document listing, and PDF download.

The DTE implementation can create, update, preview, list, and delete **drafts**. It can read already issued documents. It does **not** sign or legally issue an invoice.

## Keyring and profile state

Credentials follow the Portales profile convention:

```text
service = cl.bipbop.portales.sii
account = <profile>
```

The value is a versioned JSON bundle containing `rut` and `clave`. It must be created interactively in the OS keyring and must never appear in arguments, files, logs, fixtures, or commits.

Each profile stores cookies and audit receipts under Portales-owned user directories. Login is explicit and makes one attempt.

## Authentication

The SII surface exposes the same five commands as every authenticated service (2026-09-17):

```bash
portales sii auth setup --profile default          # hidden prompts; stores {version:1, rut, clave} in the keyring
portales sii auth status --profile default         # local only: session presence, www2 expiry, breaker, newLoginPermitted
portales sii auth login --profile default          # exactly one attempt from the keyring bundle
portales sii auth logout --profile default         # server close when possible, always wipes local material
portales sii auth breaker status --profile default # login breaker state, no credential access
```

`auth status` never contacts SII and never submits credentials; `authenticated` means a cookie jar exists locally.

Login breaker: when the keyring bundle resolved and SII rejected or never accepted the submission (`LOGIN_FAILED`), a durable breaker file is written under `$XDG_STATE_HOME/portales/sii/login-breakers/<profile>` (mode `0600`). Further `auth login` calls return `ACCOUNT_BLOCKED` until a human removes that file after review. Nothing resets it automatically. A missing bundle (`CREDENTIALS_NOT_CONFIGURED`) does not trip it because nothing was submitted.

All other commands use `default` when `--profile` is omitted.

## Error mapping

SII domain errors are converted at the command boundary (`services/sii/src/portales-errors.ts`); the Spanish message is preserved verbatim and every error carries `nextCommand` and `contractRef`:

| SII error | Code | Exit |
| --- | --- | --- |
| `NotAuthenticatedError` | `NOT_AUTHENTICATED` | 3 |
| `SessionExpiredError`, `Www2SessionError` | `SESSION_EXPIRED` | 3 |
| `LoginFailedError` | `LOGIN_FAILED` (breaker trips) | 4 |
| `CredentialNotFoundError` | `CREDENTIALS_NOT_CONFIGURED` | 4 |
| `RateLimitError` | `RATE_LIMITED` | 6 |
| `ValidationError` | `INVALID_INPUT` (with `validation` and `discoverWith`) | 2 |
| `UnexpectedResponseError` | `PROVIDER_ERROR` | 9 |
| other `SiiError` (Rcv, Dte, Bte, Representacion, F22, F29, Carpeta) | `CONTRACT_MISMATCH` | 7 |

## Entity scope

Body-RUT operations (RCV) select a represented empresa with `--empresa <rut>`; the value must be in the operable set cached at login (see `auth status`). `--empresa` is the only entity-selection option; `--rut` is rejected as an unknown option. MIPYME operations are empresa-keyed and use the same `--empresa`.

Principal-only operations (`bte list`, `bte emit`) return `supportedScopes: ["principal"]` and `principal: { rut, accountType }`. Under a representing operate pointer they fail locally with `INVALID_INPUT` (field `scope`) before any session is opened.

## RCV purchases and sales

```bash
portales sii rcv summary 2026-09 --profile default
portales sii rcv list 2026-09 --tipo 34 --profile default
portales sii rcv all 2026-09 --profile default
```

Add `--venta` for the sales register or `--empresa <rut>` for an authorized represented entity.

## Boletas de honorarios (BTE/BHE)

Session-keyed: reads and issues only for the logged-in principal (no `--rut`).

```bash
portales sii bte list 2026-09 [--recibidas] --profile default
portales sii bte comunas [--region 13]
portales sii bte emit --receptor <rut> --nombre <nombre> --domicilio <dir> \
  --region 13 --comuna 15103 --linea "<monto>:<glosa>" [--linea ...] \
  [--retiene receptor|emisor] [--fecha YYYY-MM-DD] [--sin-detalle] \
  [--enviar <email>] [--sin-copia] [--confirm <monto-total>]
```

`bte emit` without `--confirm` only previews (SII computes retención/líquido, nothing is issued).
With `--confirm` equal to the gross total it **legally issues** the boleta and returns its
código de barras and PDF URL. Emission is never retried. Email delivery via `--enviar` is
best-effort upstream (response fields not yet live-verified).

## DTE documents

Symmetric document interface (observed 2026-09-17, contract in `services/sii/docs/contracts/dte-recibidos.md`):

```bash
portales sii dte documentos list --empresa <rut> --direction issued [--folio --desde --hasta --tipo-doc --pagina] --profile default
portales sii dte documentos list --empresa <rut> --direction received [--emisor <rut> --folio --desde --hasta --tipo-doc] --profile default
portales sii dte documentos download --empresa <rut> --direction issued --folio <n> [--output <dir> | --destination <alias>] --profile default
portales sii dte documentos download --empresa <rut> --direction received --folio <n> [--emisor <rut>] [--output <dir> | --destination <alias>] --profile default
```

- `issued` uses the MIPYME emitidos listing and PDF servlet (`dte emitidos` / `dte pdf` remain as aliases).
- `received` uses the MIPYME "Ver documentos recibidos" listing (`mipeAdminDocsRcp.cgi`, the sibling of the emitidos listing) and its per-document PDF (`mipeShowPdf.cgi?CODIGO=`). Rows carry `codigo`, `emisorRut`, `emisorNombre`, `tipoDteDesc`, `folio`, `fecha`, `monto`, `estado`. Only page 1 of a filtered listing is read: the portal gates paging and its CSV export behind a reCAPTCHA, so narrow with `--folio`, `--emisor`, `--desde`/`--hasta` instead of walking pages.
- A folio shared by several emisores must be narrowed with `--emisor`; otherwise the download fails locally with `INVALID_INPUT` before any PDF request.
- The MIPYME portal is operated by the PERSONA that is "usuario autorizado" of the empresa, not by the empresa's own account: a session logged in as the empresa gets `CONTRACT_MISMATCH` ("sin opciones") from the chooser. Use the persona profile and `--empresa`.
- Received-document metadata is also available from the official RCV purchase register (`rcv all` with `COMPRA`), which carries no document links.

Every download returns the complete artifact descriptor (`artifactId`, `sha256`, `byteCount`, `mediaType`, `path`, `identifiers`, `documentType`, `extractedAt`, `coveredPeriod: null`, `validationChecks`) plus `documento` and `empresa`. Identifiers are `{empresa, folio}` for issued (`documentType: dte-pdf`) and `{empresa, emisor, folio}` for received (`documentType: dte-received-pdf`). Received PDFs are additionally checked with `pdftotext` when it is installed: the folio and both RUTs (emisor and empresa) must appear in the text (`folio-in-text`, `ruts-in-text`), otherwise `DOWNLOAD_INVALID`. Without `--output`/`--destination` the PDF stays in the profile's private documents directory; with either it is validated first and then hard-linked (or copied without overwrite) into the private destination. Destination aliases live in `~/.config/portales/destinations.json`, never in this repository.

## Electronic invoicing

```bash
portales sii dte authorized <rut>
portales sii dte empresas --profile default
portales sii dte emitidos --empresa <rut> --profile default
portales sii dte pdf <folio> --empresa <rut> --profile default
portales sii dte borrador list --empresa <rut> --profile default
portales sii dte borrador save <invoice.json> --profile default
portales sii dte borrador delete <id> --empresa <rut> --confirm <id> --profile default
portales sii dte preview <invoice.json> --profile default
```

Invoice JSON files must be private regular files with mode `0600`. Draft deletion requires the exact id twice and is never retried. Produced PDFs default to the selected profile's private Portales data directory.

## Verification methodology

Use the public CLI against the real portal with the minimum calls. The maintained unit tests cover only regressions already encountered, notably the Portales keyring namespace. Do not mirror the upstream package's test suite or add fake infrastructure preemptively.

Live verification 2026-09-17 (read-only, one call each, real portal): `auth status`, `auth login` (keyring, headless), `rcv summary` (compra, venta, `--empresa`), `rcv list --tipo`, `rcv all`, `bte list` (emitidas, recibidas, scope metadata present), `bte comunas`, `dte authorized`, `dte empresas`, `dte emitidos`, `dte documentos list --direction issued|received`, `dte borrador list`, `dte documentos download --direction issued --output <private dir>` and `--direction received --output <private dir>` (artifact descriptors, `artifacts verify` passed, received text checks passed). Every result carried the versioned envelope and one `runId` across STDERR stages. Not live-verified: `auth logout`, writes (`bte emit`, `borrador save/delete`, `dte preview`), and the breaker trip path (would require a deliberately failed login).

Two defects were found and fixed during that verification: a missing Playwright Chromium surfaced as `INTERNAL` (now classified `BROWSER_LAUNCH_FAILED` through the shared classifier), and a cross-filesystem `--output` failed at the verify stage (the shared publish helper now copies without overwrite when hard links are impossible).

The verified end-to-end path (before the migration) is:

1. `auth login` from the Portales keyring profile;
2. `rcv summary` for a real period;
3. `dte empresas`;
4. `dte emitidos` for one returned company.

No write is needed to verify the integration.
