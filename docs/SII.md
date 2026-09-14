# SII dependency

- Slug: `sii`
- Source: [`BipBop-Labs/sii`](https://github.com/BipBop-Labs/sii)
- Location: `services/sii`
- Integration: pinned Git submodule and delegated CLI
- Toolchain: pnpm 10.33.2 inside the submodule; npm remains the Portales toolchain

Portales does not copy, wrap, or reimplement SII domain operations. The complete
argument vector following `portales sii` is delegated to the CLI built from the
pinned fork commit. Standard input, output, and error are inherited unchanged,
and the SII process exit code becomes the Portales exit code. This preserves the
fork's login prompts, JSON contract, browser behavior, throttling, confirmation
gates, and legal-operation guardrails.

## Installation

```bash
git submodule update --init --recursive
npm run setup:sii
npm run build
```

`setup:sii` installs the exact pnpm version declared by the fork without mixing
its dependency graph into Portales. `npm run build` builds SII first and then the
Portales executable.

## Usage

Every upstream SII command keeps its existing shape after the service prefix:

```bash
portales sii --help
portales sii auth login
portales sii auth status
portales sii rcv summary 2026-08
portales sii f29 status 2026-08
```

JSON remains the default. `--human`, interactive prompts, and command-specific
exit codes are passed through unchanged.

## Updating the pinned fork

Only advance to commits present in `BipBop-Labs/sii`:

```bash
git -C services/sii fetch origin
git -C services/sii switch --detach origin/main
npm run setup:sii
npm run build
npm run test:sii
git add services/sii
```

Review and commit the resulting gitlink change in Portales. Never silently track
another remote or an unpinned branch.

## Verification

```bash
npm test
npm run test:sii
npm run lint
npm run lint:sii
node dist/apps/cli/src/main.js sii --version
```

Authenticated commands keep all session and credential storage owned by the SII
dependency. No SII secret or session material belongs in the Portales repository.
