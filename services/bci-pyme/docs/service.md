# BCI Pyme

- Slug: `bci-pyme`
- Official portal: `https://www.bci.cl/corporativo/banco-en-linea/pyme`
- Account scope: businesses and accounts available to one BCI Pyme login profile
- Credential store: operating-system Secret Service
- Authentication: explicit, one attempt, no automatic retry
- Supported effects: discovery, cartola download, recipient creation, authorization and deletion

## Keyring namespace

BCI uses this exact Secret Service identity:

```text
service = cl.bipbop.portales.bci
account = <profile>
```

For the default profile:

```text
service = cl.bipbop.portales.bci
account = default
```

The namespace intentionally uses `bci`, not the CLI slug `bci-pyme`. Treat it as a stable compatibility contract. Do not derive, rename, alias, or probe alternative namespaces.

The secret is opaque versioned JSON owned only by the BCI authentication adapter. Version 1 has exactly three fields:

- `version`: the integer `1`;
- `rut`: a non-empty string;
- `password`: a non-empty string.

Real values must never appear in documentation, examples, tests, shell history, process arguments, environment variables, logs, or task input.

## Credential setup

Run in an interactive terminal:

```text
portales bci-pyme auth setup --profile default
```

The command reads both fields with terminal echo disabled, validates the credential
bundle locally, and asks for confirmation before storing or replacing the exact
Secret Service entry. It accepts only `--profile`; arguments, environment variables,
files, and redirected stdin cannot supply credentials. It reports only configuration
status and profile. Setup does not authenticate or reset a login breaker. Unlock the
existing system keyring if needed; a failed store returns `KEYRING_UNAVAILABLE`.

## Login

Login is always explicit:

```text
portales bci-pyme auth login --profile default
```

The implementation must:

1. verify that the BCI login circuit breaker is clear;
2. read `(cl.bipbop.portales.bci, default)` through the read-only `SecretReader`;
3. make exactly one login attempt;
4. persist only the minimum authenticated browser session outside the repository;
5. stop without retry on invalid credentials, unknown completion, CAPTCHA, MFA, Turnstile, access denial, rate limiting, block, or changed stages.

The login control facts (`#rut_aux`, the unique password input, `INGRESAR`, and the
native top-level POST form) were re-observed in a headed browser on 2026-09-14 without
submitting credentials. The adapter uses each exact control once and fails closed on
any mismatch. `Omitir por ahora` remains authenticated-flow evidence from the dated
contract.

Listing and download commands never perform implicit login.

## Authentication surface (2026-09-17)

Every command below is local-only unless stated; none submits credentials or opens a browser:

```text
portales bci-pyme auth setup --profile <name>            # interactive keyring enrollment
portales bci-pyme auth login --profile <name>            # exactly one explicit attempt (browser)
portales bci-pyme auth status --profile <name>           # local session/breaker metadata
portales bci-pyme auth logout --profile <name>           # removes local session material
portales bci-pyme auth breaker status --profile <name>   # circuit-breaker state
```

`auth status` reports `sessionPresent`, `savedAt`, `earliestCookieExpiry`, `locallyExpired`,
`lastAuthenticatedStage` (a static stage name recorded on the last accepted login),
the breaker state, `newLoginPermitted`, and `liveness: "unknown-local-only"`. It reads
only cookie metadata, never values, and makes no server-side liveness claim.

`auth logout` deletes `session-state.json` and any legacy profile cookies. The recorded
contract contains no observed BCI logout route, so `remoteRevoked` is always `false`.

## Browser session

On Linux, browser-backed `portales bci-pyme ...` commands transparently relaunch once under `xvfb-run -a`, even when a desktop `DISPLAY` is available. Chrome remains headed (`headless: false`) on a private virtual display, so no browser window appears on the desktop. Interactive credential setup stays in the caller’s terminal. Callers still use only the public `portales` interface; they must not prepend Xvfb manually or invoke compiled modules. Other services are not wrapped. Linux deployments that enable BCI Pyme must provide `xvfb-run` on `PATH`.

The browser session is separate from the keyring item. It may contain cookies, CSRF values, device identifiers, and local storage, all of which are secrets.

Store session state under a private service/profile-specific location with user-only permissions. Never combine BCI with another portal or organization in one browser profile. Session expiry returns `SESSION_EXPIRED`; it does not trigger login automatically.

The adapter saves BCI cookies and origin local storage in `session-state.json`
(mode `0600`, inside the private `0700` profile directory). Each command restores
that state into a fresh temporary Chrome profile; downloads and other internal Chrome
state are not reused. This preserves session cookies that Chromium otherwise drops
between commands and avoids the observed crash when reopening a profile after a
download. The temporary profile is removed when its browser closes. Existing profiles
are migrated locally once without navigation or authentication. Session files are
secrets, never diagnostics or repository content.

A device-registration offer is not authorization to enroll the device. The adapter may choose the observed non-enrollment path only when documented and unambiguous. It must never activate device registration or approval.

## Intended calls

After an explicit successful login:

```text
portales bci-pyme businesses list --profile default
portales bci-pyme businesses options --profile default --tree
portales bci-pyme accounts options --profile default --business-id <discovered-id>
portales bci-pyme cartolas options
portales bci-pyme cartolas prepare --profile default --business <label-or-id> --account <label-or-id>
portales bci-pyme cartolas download --profile default --snapshot <snapshot-id> [--output <private-dir> | --destination <alias>]
portales bci-pyme cartolas download --profile default --business-id <id> --account-id <id>
portales bci-pyme cartolas download --profile default --input <private-json-file>
```

`businesses options --tree` returns every business with its nested accounts from one
session. Option results carry `observedAt`, `source` (`live` or `packaged`),
`contractVersion`, and `freshness`. Within one run a business's accounts are discovered
at most once; nothing is cached across runs except snapshots.

### Prepare and snapshots (2026-09-17)

`cartolas prepare` opens one session, resolves each `--business`/`--account` pair
(exact ID first, then a unique accent- and case-insensitive label match) and fails with
`INVALID_INPUT` listing candidate IDs when resolution is not unique. It returns the
normalized selections, a `fingerprint` (SHA-256 of the selections plus the discovered
option IDs), and a `snapshotId`. The snapshot is stored privately under
`$XDG_STATE_HOME/portales/bci-pyme/snapshots/<profile>/<snapshotId>.json` (mode 0600),
holds only discovered IDs/labels, selections, and `contractVersion`, and expires after
15 minutes.

`cartolas download --snapshot <id>` validates the snapshot before opening a browser
(`INVALID_INPUT` for another profile or unknown ID, `SNAPSHOT_EXPIRED` past
`expiresAt`), then re-discovers the selected businesses' accounts and rejects with
`SNAPSHOT_STALE` when any business or account ID appeared or disappeared, naming the
smallest diff. Exactly one selection source is accepted per call.

### Destinations and artifact descriptors

Each verified XLSX is published atomically (no overwrite) to one of:

- `--output <dir>`: an existing private (0700) directory outside any repository;
- `--destination <alias>`: an alias from the private file
  `$XDG_CONFIG_HOME/portales/destinations.json`
  (`{"version":1,"destinations":{"<alias>":{"directory":"/abs/path","service":"bci-pyme","profile":"default"}}}`),
  never committed to the repository;
- default: `$XDG_DATA_HOME/portales/artifacts/bci-pyme/<profile>/excel-detallado/<businessId>/<accountId>/`.

The result contains one complete artifact descriptor per download: `artifactId`, service,
profile, `identifiers` (`businessId`, `accountId`), `documentType`, `extractedAt`,
`coveredPeriod` (always `null`: the observed movements view exposes no date range),
`byteCount`, `mediaType`, `sha256`, `validationChecks`, `destinationSource`, and the
private `path`. Descriptors are indexed for `portales artifacts list|show|latest|verify`.

Business and account IDs must come from the corresponding discovery command. They must not be guessed from labels or placed in public examples.

The private download input carries selected discovered IDs and document type. It exports the portal's current movements view; the observed UI does not expose a date-range dialog. The result contains private file descriptors only: generated path, media type, byte count, checksum, and per-item status. It never returns document contents.

## Circuit breaker

An authentication failure or ambiguity before BCI accepts the login trips a durable profile-specific circuit breaker. `auth breaker status` reports `tripped`, `trippedAt`, `newLoginPermitted`, and `resetRequires: "human-review"`; a tripped breaker makes `auth login` fail with `ACCOUNT_BLOCKED` before reading credentials. Errors after acceptance are post-login failures and may be retried through the authenticated session without re-entering credentials. Ordinary tasks cannot reset or bypass a genuine authentication breaker. Reset requires explicit human review and a separate administrative operation.

## Forbidden capabilities

Transfers, payments and device enrollment remain unsupported. Recipient creation and
BciPass recipient authorization are supported; their live-verification status is
tracked in [the recipient contract](contracts/destinatarios.md).

## Implemented read-only surface

- `auth.login`: performs one explicit keyring-backed login and trips the profile
  breaker only when authentication fails or remains ambiguous before acceptance.

- `businesses.list`: discovers businesses from an existing authenticated session.
- `accounts.options`: discovers all accounts for one exact discovered business ID.
- `cartolas.options`: lists the documented cartola document types.
- `cartolas.download`: validates discovered IDs and writes verified documents to a private user directory.
- `destinatarios.options`: discovers the complete live bank catalog for a discovered business.
- `destinatarios.list`: reads authorized and pending recipients and their detail fields for a discovered business.

```text
portales bci-pyme destinatarios options --profile default --business-id <discovered-id>
portales bci-pyme destinatarios list --profile default --business-id <discovered-id>
```

Recipient listing returns `{ businessId, recipients }`. Each recipient has `status`
(`authorized` or `pending`), `name`, `alias`, `rut`, `email`, `bank` and `accountNumber`.
These values are private; redirect output only to a private file outside the repository.
The currently verified listing supports one page per status; additional pages stop
with `PORTAL_CHANGED` rather than returning an incomplete list.

The current browser-flow contract records the sanitized live observations in [`contracts/read-only-browser-flow.md`](contracts/read-only-browser-flow.md). It must fail with `PORTAL_CHANGED` rather than broaden selectors when the real portal differs.

## Recipient writes

Discover the business with `businesses list` and bank with `destinatarios options`.
Keep recipient JSON in a mode-0600 file outside the repository. Creation accepts
`businessId`, `bankId`, `name`, `alias`, `rut`, `accountNumber`, optional `email` and
optional `favorite` (default false). Authorization accepts only `businessId`, `bankId`,
`rut` and `accountNumber`, identifying a recipient returned by `destinatarios list`.
Account numbers must be strings. No account-type field is exposed by the observed form.

```text
portales bci-pyme destinatarios prepare --action create --profile default --input <private-json-file>
portales bci-pyme destinatarios create --profile default --input <private-json-file> --confirm <preview-confirmation>
portales bci-pyme destinatarios prepare --action authorize --profile default --input <private-json-file>
portales bci-pyme destinatarios authorize --profile default --input <private-json-file> --confirm <preview-confirmation>
```

Prepare performs no write. Its confirmation binds the profile, operation, recipient,
bank and current state; changed data requires a fresh preview. Creation refuses
duplicates with conflicting details and reports an exact existing recipient without
resubmission. Authorization likewise reports an already authorized recipient without
sending another approval request. These commands never log in implicitly.

The default flow separates creation from authorization. `create` submits once, then
verifies the saved recipient in the listing and returns its actual status. It does
not ask the user to approve the automatic challenge opened by the creation screen.
If pending, prepare and execute `authorize` for that existing recipient.

After a single authorization submission, `authorize` keeps the same browser open for
up to five minutes. JSON progress on STDERR reports `awaiting-bcipass` and `verifying-bcipass`;
approve in the phone app while the process runs. Do not terminate it, run another BCI
command or close its browser during approval. No OTP is accepted through task inputs.
Only a recognized terminal portal outcome allows listing reconciliation. A phone
approval alone never produces success. STDOUT contains one final verified result.

Creation normally returns `outcome: pending` when BCI saved the recipient. Use the
separate authorization operation for that existing recipient.
Unknown results or timeouts return `REMOTE_STATE_AMBIGUOUS`; inspect `destinatarios
list` before another write. No mutation or authorization is automatically retried.

## Recipient deletion

Deletion accepts the same private selection fields as authorization: `businessId`,
`bankId`, `rut`, `accountNumber`. It requires a fresh preview and its exact confirmation.

```text
portales bci-pyme destinatarios prepare --action delete --profile default --input <private-json-file>
portales bci-pyme destinatarios delete --profile default --input <private-json-file> --confirm <preview-confirmation>
```

The adapter rechecks the recipient details in the selected business, opens the
observed deletion question, and clicks its `Eliminar` button once. It returns
`outcome: deleted` only after the recipient is absent from both statuses. A missing
target, changed details, ambiguous confirmation or uncertain result stops execution.
An error never triggers a second click. Deletion does not initiate a transfer.

## Related documentation

- [OS keyring contract](../../../docs/KEYRING.md)
- [Security and account safety](../../../docs/SECURITY.md)
- [CLI conventions](../../../docs/CONVENTIONS.md)
