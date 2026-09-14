# Architecture

## Goal

Make every portal operation easy for an agent to discover and hard to misuse. The stable unit is a **task**: one typed operation with a small input, a JSON-serializable result, an explicit effect, and all safety policy below its interface.

## Boundaries

```text
apps/cli ──▶ service tasks ──▶ service portal code ──▶ runtime seams ──▶ portal
                   │                    │                    │
                   └── policy           └── observed facts   └── adapters
```

### CLI surface

The CLI translates inputs, calls exactly one task, and presents its result. It does not navigate, parse HTML, read the keyring, restore sessions, pace calls, audit operations, or decide whether a write is safe.

The CLI is the only maintained public interface because humans and agents can both invoke it, compose it with ordinary tools, and inspect its exact input, output, and exit status. Do not add parallel protocol adapters or duplicate command behavior in another surface.

### Service tasks

A task is the public core of an operation. It owns:

- input validation and canonicalization;
- authentication/session requirements;
- authorization and active-account checks;
- pacing and retry policy;
- preview and confirmation gates;
- audit receipts;
- conversion from portal shapes to stable results;
- post-write verification.

Tasks return plain JSON values. No `Date`, `Map`, `Set`, browser object, response object, cookie jar, secret, or raw document bytes cross this boundary.

### Service portal modules

Portal modules contain service-specific knowledge: destinations, readiness conditions, selectors, request shapes, response parsing, and changed-portal detection. This knowledge stays with the service instead of leaking into generic runtime code.

A portal module may use browser navigation or replay an observed request within an authenticated browser context. Replay is an implementation detail, never a different public task.

### Runtime

`packages/runtime` should begin with only the seams needed by the first operation:

- `BrowserDriver` and authenticated `BrowserSession`
- read-only `SecretReader` backed by the OS keyring
- `SessionStore` for cookies or browser storage when required
- `Clock` for pacing and deterministic tests
- `AuditSink` for redacted receipts
- `FileSink` for verified downloads

Secret creation belongs to a dedicated interactive CLI setup path with hidden input. The ordinary command runtime receives only a read capability. This makes secret writes unavailable by construction.

Add a new seam only when it hides a volatile dependency or makes a load-bearing rule testable. Do not build a framework around hypothetical providers.

## Future repository shape

```text
apps/cli
packages/runtime
services/<service>/{docs,src/tasks,src/portal,test/fixtures}
```

A service owns its tasks, portal code, contracts, and fixtures. The central CLI adds one registration line per service. Avoid central switch statements containing service behavior.

Do not create generic `BaseScraper`, `BasePortal`, repository, manager, or controller classes. These names usually hide shallow modules. Extract shared code only after two implemented services reveal the same knowledge and the resulting interface is substantially simpler than both implementations.

## Authentication lifecycle

Authentication is explicit:

1. An interactive setup command stores a provider-specific credential bundle in the OS keyring.
2. `portales <service> auth login --profile <name>` validates non-secret identity data locally, reads the bundle through `SecretReader`, and makes exactly one login attempt.
3. On success, the task persists only the minimal session material needed by later operations.
4. Domain tasks consume a valid session or return `NOT_AUTHENTICATED` / `SESSION_EXPIRED`. They never log in implicitly.
5. Logout revokes server state when possible and always removes local session material.

Keyring namespace:

- service: `cl.bipbop.portales.<service>`
- account: user-selected profile name, default `default`
- secret value: an opaque, versioned provider credential bundle owned by that service's auth adapter

Public interfaces carry only the profile name. They never expose the secret bundle schema.

## Operation effects

Every operation declares one effect:

- `read`: cannot intentionally change remote state;
- `write`: changes reversible or replaceable state;
- `destructive`: creates an irreversible, financial, legal, or deletion effect.

This metadata drives CLI help, confirmation requirements, audit behavior, and tests. It is descriptive policy attached to the task, not duplicated by commands.

A destructive task must expose a preview or summary whenever the portal permits it, require an explicit confirmation value tied to the proposed action, execute once, and query live state before reporting success.

## Files and large results

Documents and exports are written through `FileSink`. A task returns a descriptor such as path, media type, byte count, checksum, and business identifiers. It never places document bytes or base64 in JSON output.

Validate downloads using declared content type, file signature, and expected document content. HTTP 200 alone is not proof of success.

## Dependency direction

Allowed:

```text
CLI -> task -> portal -> runtime interfaces
runtime adapters -> runtime interfaces
```

Forbidden:

```text
CLI -> portal
CLI -> keyring
portal -> CLI
task -> CLI
service A -> service B portal internals
```

These boundaries keep volatile portal details and security policy below small, stable interfaces.
