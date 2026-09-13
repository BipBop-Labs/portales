# Portales

Agent-friendly tools for safe, consistent interaction with web portals.

`portales` is a planned BipBop Labs TypeScript monorepo for integrations that do not have a dependable public API and therefore require browser automation, observed private requests, or both. The first intended service modules are:

- `sii`: Chile's Servicio de Impuestos Internos, informed by [`BipBop-Labs/sii`](https://github.com/BipBop-Labs/sii).
- `sag`: the SAG digital entry declaration flow already proven through browser automation.
- `bci-pyme`: BCI's business banking portal.

## Status

Architecture and conventions only. No scraper, login flow, bank integration, or portal operation is implemented yet.

The next implementation should add one narrow, read-only operation end to end. It must begin with a real browser investigation, not guessed requests.

## Why the name

**Portales** says what the repository is about without naming a transport. A service may begin as browser automation and later replay an observed request without changing its public identity.

## Design in one minute

```text
CLI / MCP
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

- One core task per operation. CLI and MCP are thin surfaces over the same task.
- Credentials come only from the operating-system keyring. They are never command arguments, environment variables, files, logs, fixtures, or MCP inputs.
- Observe the real browser flow before replaying any request.
- Authentication and mutations are never retried automatically.
- JSON is the default machine interface. Human formatting is optional presentation.
- Shared abstractions are extracted only after a second real service proves the common shape.

## Documentation

Agents should read these files in order:

1. [`AGENTS.md`](AGENTS.md): operating rules and required reading.
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): module boundaries and future tree.
3. [`docs/RESEARCH-FIRST.md`](docs/RESEARCH-FIRST.md): how to investigate portals safely.
4. [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md): task, CLI, MCP, error, naming, and test contracts.
5. [`docs/SECURITY.md`](docs/SECURITY.md): credentials, sessions, PII, audit, and write safety.
6. [`docs/ADDING-A-SERVICE.md`](docs/ADDING-A-SERVICE.md): minimal service workflow and specification template.
7. [`docs/decisions/README.md`](docs/decisions/README.md): lightweight decision notes, used only when warranted.

## Proposed future tree

The tree is a destination, not permission to create empty layers:

```text
apps/
  cli/                         unified `portales` command
  mcp/                         optional stdio MCP surface
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
