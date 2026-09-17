# OS keyring contract

Portales stores credentials only in the operating system's Secret Service. Repository files, environment variables, command arguments, stdin payloads, browser profiles, logs, fixtures, and task inputs are not credential stores.

## Ownership

Each service owns one stable keyring namespace documented in `services/<service>/docs/service.md`.

- `service`: stable reverse-domain namespace owned by the service adapter
- `account`: public profile name, such as `default`
- secret: opaque, versioned JSON bundle interpreted only by that service's authentication adapter

Do not derive the `service` attribute from the CLI slug at runtime. Renaming a command must not orphan credentials.

## Public commands

Credential creation is an explicit interactive operation:

```text
portales <service> auth setup --profile <name>
```

It must:

1. require an interactive TTY;
2. read secret fields with terminal echo disabled;
3. validate non-secret structure locally;
4. write directly to Secret Service;
5. clear transient buffers where practical;
6. return only `configured: true` and the non-secret profile name.

It must reject credential values supplied through arguments, environment variables, redirected stdin, JSON task input, or config files.

Authentication is a separate one-shot operation:

```text
portales <service> auth login --profile <name>
```

It reads the opaque bundle through `SecretReader`, attempts login exactly once, and never prints or returns fields from the bundle.

## Runtime interface

Application code asks for a bundle by attributes equivalent to:

```text
SecretReader.read({ service, account: profile })
```

The runtime must use a Secret Service library or a subprocess API that captures the value in memory. Never invoke a lookup command whose secret stdout is inherited by a terminal, agent, log collector, or CI job.

The read capability cannot create, replace, enumerate, or delete secrets. Secret writes belong only to the interactive setup path.

## Namespaces in use

| Service | `service` attribute | Bundle |
| --- | --- | --- |
| `bci-pyme` | `cl.bipbop.portales.bci` | `{ "version": 1, "rut", "password" }` |
| `sii` | `cl.bipbop.portales.sii` | `{ "version": 1, "rut", "clave" }` |

`portales doctor --json` reports whether `secret-tool` is installed and whether a Secret Service provider answers on the session bus (gnome-keyring, or KWallet with its Secret Service compatibility enabled). It never reads a bundle. `portales <service> auth status` reports local session presence and the login breaker without touching the keyring.

## Availability and unlocking

The host is responsible for starting and unlocking Secret Service before a login command. Portales may report only:

- `CREDENTIALS_NOT_CONFIGURED` when no matching item exists;
- `KEYRING_LOCKED` when Secret Service denies access;
- `KEYRING_UNAVAILABLE` when the service cannot be reached.

It must not automatically create a keyring, reset its password, expose unlock material, or fall back to plaintext storage.

## Rotation and removal

Rotation repeats the interactive setup command and replaces the exact `(service, account)` item after confirmation. Removal is an explicit interactive operation and must name the non-secret profile. Neither action logs the old or new bundle.

## Testing

Default tests use a fake `SecretReader` with independently synthetic values. They never open the production keyring. Tests cover missing, locked, malformed-version, and successful-read behavior without snapshots of secret values.
