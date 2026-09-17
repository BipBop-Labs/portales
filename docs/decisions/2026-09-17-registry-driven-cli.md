# Decision: one task registry drives help, catalog, describe and dispatch

- Date: 2026-09-17
- Status: accepted

## Context

The CLI grew as three hand-written dispatchers (BCI, SII, SAG) with ad-hoc argument parsing and a `--help` that existed for one service. Agents discovered commands by reading source, `--help` needed a profile for some paths, and validation errors said "Unknown command." A capability catalog for agents cannot be maintained as a second document without drifting.

## Decision

Every public command is a `CommandSpec` (`packages/runtime/src/registry.ts`) registered in `apps/cli/src/commands/<service>.ts`. The registry generates hierarchical `--help`, `portales catalog --json`, `portales describe <service> <resource> <action> --json`, argument parsing with actionable validation errors (`field`, `expected`, `discoverWith`, `nextCommand`), lifecycle events, run records, locks and the versioned envelope. Command shape is fixed to `portales <service> <resource> <action>`, with global commands (`catalog`, `describe`, `version`, `doctor`, `runs`, `artifacts`, `contract`) addressed without a service word.

## Alternatives

- Keep per-service dispatchers and write a catalog document by hand: rejected, it drifts on the first change.
- Adopt a CLI framework (commander, yargs, oclif): rejected for now; the spec needs effect/auth/browser/contract metadata that no framework models, and the parser is under 200 lines.
- Expose an MCP server or JSON-RPC surface: rejected; the CLI remains the single maintained interface (see `ARCHITECTURE.md`), and `catalog --json` gives agents the same discoverability.

## Consequences

Adding a command is one object. `describe` is the authoritative contract, so Markdown stops describing arguments. Every spec must carry `effect`, `auth`, `browser`, `contractRef` and `contractVersion`, and a `.json` contract must list the operation. The runner owns STDOUT; tasks never print.
