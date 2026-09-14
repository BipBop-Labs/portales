# Portales

Agent-friendly tools for safe, consistent interaction with web portals.

`portales` is a planned BipBop Labs TypeScript monorepo for integrations that do not have a dependable public API and therefore require browser automation, observed private requests, or both. The first intended service modules are:

- `sii`: Chile's Servicio de Impuestos Internos, informed by [`BipBop-Labs/sii`](https://github.com/BipBop-Labs/sii).
- `sag`: the SAG digital entry declaration flow already proven through browser automation.
- `bci-pyme`: BCI's business banking portal.

Service specifications:

- [`bci-pyme`](services/bci-pyme/docs/service.md): exact keyring namespace, authentication boundary, browser-session rules, and planned read-only calls.

## Status

The current branch implements a guarded BCI Pyme slice: explicit one-attempt login,
session-only discovery, and validated cartola download. Its portal selectors remain
fail-closed pending the live observations identified in the service contract.

This is a public repository. Only synthetic examples and fixtures may be committed. Data from users, clients, chats, documents, screenshots, local files, or live portal sessions is never repository material.

The next implementation should add one narrow, read-only operation end to end. It must begin with a real browser investigation, not guessed requests.

## Why the name

**Portales** says what the repository is about without naming a transport. A service may begin as browser automation and later replay an observed request without changing its public identity.

## Design in one minute

```text
CLI
 │
 ▼
service task                 stable, JSON-serializable contract
    │
    ▼
service portal module         service-specific navigation and parsing
    │
    ▼
runtime seams                browser, keyring, session, clock, audit, files
    │
    ▼
real portal
```

- One core task per operation. The CLI is its only maintained public surface.
- Credentials come only from the operating-system keyring. They are never command arguments, environment variables, files, logs, or fixtures.
- Observe the real browser flow before replaying any request.
- Authentication and mutations are never retried automatically.
- JSON is the default machine interface. Human formatting is optional presentation.
- Every portal-defined selector has a CLI `options` command, so agents can discover valid IDs and labels instead of guessing.
- Shared abstractions are extracted only after a second real service proves the common shape.

## Documentation

Agents should read these files in order:

1. [`AGENTS.md`](AGENTS.md): operating rules and required reading.
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): module boundaries and future tree.
3. [`docs/RESEARCH-FIRST.md`](docs/RESEARCH-FIRST.md): how to investigate portals safely.
4. [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md): task, CLI, error, naming, and test contracts.
5. [`docs/SECURITY.md`](docs/SECURITY.md): credentials, sessions, PII, audit, and write safety.
6. [`docs/KEYRING.md`](docs/KEYRING.md): exact Secret Service ownership and runtime contract.
7. [`docs/ADDING-A-SERVICE.md`](docs/ADDING-A-SERVICE.md): minimal service workflow and specification template.
8. [`docs/decisions/README.md`](docs/decisions/README.md): lightweight decision notes, used only when warranted.

## Proposed future tree

The tree is a destination, not permission to create empty layers:

```text
apps/
  cli/                         unified `portales` command
packages/
  runtime/                     small, shared seams and Node adapters
services/
  sii/
  sag/
  bci-pyme/
    docs/
      service.md               auth, risks, observed flows, operation catalog
      contracts/               dated portal evidence and wire contracts
    src/
      tasks/                   public operations and guardrails
      portal/                  provider-specific navigation, replay, parsing
    test/
      fixtures/                sanitized, synthetic fixtures only
```

Do not create a directory until an implemented operation needs it.
