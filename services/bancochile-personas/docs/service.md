# Banco de Chile Personas

- Slug: `bancochile-personas`
- Official portal: `https://portalpersonas.bancochile.cl/persona/` (login at `login.portales.bancochile.cl`, an Auth0 tenant)
- Account scope: the personal accounts available to one Banco de Chile personas login
- Credential store: operating-system Secret Service
- Authentication: explicit, one attempt, no automatic retry
- Supported effects: authentication, recipient listing, own accounts and account movements.
  Recipient changes: favourite and name/alias edit with Mi Pass (`write`), deleting one account
  (`destructive`). Transfers: `transferencias prepare` (`read`) and `transferencias create`
  (`destructive`, Mi Pass) ([contract](contracts/transferencias.md)). Planned, in order: cartola, credit-card statement, transfers, credit-card payment. Transfers
  and card payments will be `destructive` operations with prepare, explicit confirmation, one
  execution and live verification. Business banking
  (`portalempresas`) is out of scope.

## Keyring namespace

```text
service = cl.bipbop.portales.bancochile
account = <profile>
```

The namespace uses `bancochile`, not the CLI slug, so a future business-banking service could
share it only if the bank proves the same credentials apply. Treat it as a stable compatibility
contract. The secret is opaque versioned JSON owned by this adapter. Version 1 has exactly
`version` (the integer `1`), `rut` (a valid RUT, dots and dash optional) and `password`.

There is no interactive `auth setup` yet. Any Secret Service writer may store the bundle under
the exact attributes; values never appear in arguments, environment variables of the CLI, files,
logs, or this repository.

## Login

```text
portales bancochile-personas auth login --profile default
```

The task checks the profile's login breaker, reads the bundle once, and makes one attempt
through the observed form ([contract](contracts/auth-login.md)). It stops without retry on
CAPTCHA, Mi Pass or other second factor, block, rate limit, or an unrecognized result. Listing
and other read commands never log in implicitly.

## Browser session

Browser-backed commands relaunch once under `xvfb-run -a` on Linux and drive headed Chrome
stable. The adapter saves `bancochile.cl` cookies and origin storage in `session-state.json`
(mode `0600`, inside `$XDG_STATE_HOME/portales/bancochile-personas/<profile>/browser/`, mode
`0700`) and restores it into a fresh temporary Chrome profile per command. Session files are
secrets. The bank ended an idle session after roughly 20 minutes (observed 2026-10-30); the
next command then fails with `SESSION_EXPIRED` and never logs in by itself. `auth logout` deletes them; no remote logout route has been observed, so
`remoteRevoked` is always `false`.

## Circuit breaker

A failure or ambiguity after the credentials were submitted and before the portal accepted
them trips a durable breaker at `$XDG_STATE_HOME/portales/bancochile-personas/login-breakers/<profile>`.
`auth breaker status` reports it; `auth login` then fails with `ACCOUNT_BLOCKED` before
reading credentials. Reset requires human review (remove the marker after checking the account
in a normal browser).

## Recipients

```text
portales bancochile-personas destinatarios list --profile default
portales bancochile-personas destinatarios show --profile default --name <words>
portales bancochile-personas destinatarios show --profile default --rut <rut>
portales bancochile-personas destinatarios show --profile default --id <id-from-list>
```

Reads the transfer agenda ([contract](contracts/destinatarios.md)) and returns every recipient
with all their accounts, across every bank. `show` finds one recipient by name words (case-
and accent-insensitive), RUT in any format, or ID; several name matches return the candidates
with their IDs instead of guessing. The output is private: redirect it only to a private file outside the
repository.

## Recipient changes

```text
portales bancochile-personas destinatarios prepare --profile default --action favorite --recipient-id <id> --account-id <id> --favorite true
portales bancochile-personas destinatarios favorite --profile default --recipient-id <id> --account-id <id> --favorite true --confirm <confirmation>
portales bancochile-personas destinatarios prepare --profile default --action delete-account --recipient-id <id> --account-id <id>
portales bancochile-personas destinatarios delete-account --profile default --recipient-id <id> --account-id <id> --confirm <confirmation>
```

```text
portales bancochile-personas destinatarios prepare --profile default --action edit --recipient-id <id> --name <name> --alias <account-id>=<alias>
portales bancochile-personas destinatarios edit --profile default --recipient-id <id> --name <name> --alias <account-id>=<alias> --confirm <confirmation>
```

Favourite and delete apply immediately in the portal, without Mi Pass. An edit asks for Mi Pass:
STDERR reports `awaiting-mipass`, approve it in the Mi Pass app (open the app; a notification may
not arrive) within five minutes, and do not stop the command meanwhile. Prepare changes nothing; execution
acts once and verifies by re-reading the agenda ([contract](contracts/destinatarios-escritura.md)).

## Own accounts and movements

```text
portales bancochile-personas cuentas list --profile default
portales bancochile-personas movimientos list --profile default --account <number>
portales bancochile-personas movimientos list --profile default --account <number> --from 2026-10-01 --to 2026-10-31
```

`cuentas list` returns each own account with its available balance. `movimientos list` without
dates returns the portal's default view (about 45 days, including movements already made that post
on a later business day); with dates it filters by accounting date, both days included, at most 45
days per call ([contract](contracts/cuentas-movimientos.md)).

## Transfers

```text
portales bancochile-personas transferencias prepare --profile default --recipient-id <id> --account-id <id> --amount 1000 --message "..."
portales bancochile-personas transferencias create --profile default --recipient-id <id> --account-id <id> --amount 1000 --message "..." --confirm <confirmation>
```

Immediate transfers from the current account to an agenda recipient account. Approve Mi Pass in the
app within about three minutes. Success is verified as a new debit in the movements; never repeat a
transfer after an error before checking `movimientos list`.

## Data handling

RUTs are returned in the canonical form `12345678-9` (no dots, dash, uppercase K) from the
shared `packages/runtime/src/rut.ts`, whatever the portal sends.

RUTs, names, account numbers, balances, recipients and movement descriptions are private.
Only synthetic values may appear in tests and documentation.
