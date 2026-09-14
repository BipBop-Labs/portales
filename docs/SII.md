# SII dependency

- Slug: `sii`
- Source: [`BipBop-Labs/sii`](https://github.com/BipBop-Labs/sii)
- Location: `services/sii`
- Integration: pinned Git submodule and delegated CLI
- Toolchain: pnpm 10.33.2 inside the submodule; npm remains the Portales toolchain

Portales does not copy or reimplement SII domain operations. Except for the
profile-aware login described below, the complete argument vector following
`portales sii` is delegated to the CLI built from the pinned fork commit. Standard
input, output, and error are inherited unchanged, and the SII process exit code
becomes the Portales exit code. This preserves the fork's JSON contract, browser
behavior, throttling, confirmation gates, and legal-operation guardrails.

## Keyring contract

SII follows the standard Portales profile convention:

```text
service = cl.bipbop.portales.sii
account = <profile>
```

The secret is an opaque JSON bundle owned by the SII adapter:

```json
{
  "version": 1,
  "rut": "20.000.042-0",
  "clave": "synthetic-secret"
}
```

The example is entirely synthetic. Real bundles must be created interactively
and must never appear in arguments, environment variables, stdin payloads,
repository files, logs, or fixtures.

`portales sii auth login --profile <profile>` captures the bundle through the
shared read-only `SecretReader`, validates its version, and gives the Clave only
to the fork's `keyringLogin` task in memory. The login task makes one attempt and
persists only the SII session material. Portales does not use the fork's legacy
`service=sii, username=<rut>` keyring layout.

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
portales sii auth login --profile default
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

Authenticated commands keep session storage owned by the SII dependency and
credential storage under the Portales keyring contract. No SII secret or session
material belongs in either repository.
