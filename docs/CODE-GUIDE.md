# How to write code here

This is the pattern guide. `ARCHITECTURE.md` says what the layers are, `CONVENTIONS.md` says what the contracts are, `docs/decisions/` says why. This document shows the shape of a correct change so you can copy it instead of rediscovering it.

Every change follows the same order: read the existing command and contract, observe the real flow if a portal is involved, write the task, register the command, add the contract facts, run the local checks, verify live once, document the date.

## 1. The layers, with the file that defines each

| Layer | Owns | Lives in | Never does |
| --- | --- | --- | --- |
| Command spec | parsing, help, catalog, describe, stage events, envelope | `apps/cli/src/commands/<service>.ts` | navigate, parse HTML, read the keyring |
| Task | validation, session requirement, effect policy, result shaping | `services/<service>/src/tasks/*.ts` | import Playwright, print, know about the CLI |
| Portal module | destinations, readiness, selectors, request replay, page-state classification | `services/<service>/src/portal/*.ts` | decide whether a write is safe, log in implicitly |
| Runtime | registry, errors, runs, locks, artifacts, destinations, contracts, observation | `packages/runtime/src/*.ts` | contain service knowledge |

The dependency direction is `command spec → task → portal → runtime`. If you need to go the other way, you are in the wrong layer.

## 2. Registering a command

A command is one `CommandSpec` object. The registry generates `--help`, `catalog`, `describe`, argument validation, lifecycle events, run records, locks and the envelope from it. You write none of that.

```ts
// apps/cli/src/commands/<service>.ts
{
  service: 'bci-pyme', path: ['accounts', 'options'],
  summary: 'Discover the account IDs valid for one exact business.',
  effect: 'read', auth: 'session', browser: 'headed', profile: 'required',
  options: [{ name: 'business-id', kind: 'string', required: true,
    description: 'Portal-native business ID.',
    discoverWith: 'portales bci-pyme businesses list --profile <profile>' }],
  output: { description: '{ field, dependsOn, options }' },
  errors: ['INVALID_INPUT', 'NOT_AUTHENTICATED', 'SESSION_EXPIRED', 'CONTRACT_MISMATCH'],
  contractRef: 'services/bci-pyme/docs/contracts/read-only-browser-flow.md#observed-flow',
  contractVersion: '2026-09-14',
  run: (input, context) => withPortal(context, input.profile, async (portal) => {
    context.stage('navigate');
    const result = await listAccountOptions({ profile: input.profile, businessId: input.options['business-id'] }, portal);
    context.stage('parse');
    return result;
  }),
}
```

Rules that follow from the shape:

- `path` words are the public command. `operation` is `path.join('.')`. Do not invent a second naming scheme.
- Every constrained argument carries `discoverWith`. The parser puts it in the validation error and in `nextCommand`; you never write that message by hand.
- `effect`, `auth`, `browser`, `contractRef` and `contractVersion` are not decoration. Doctor, locks, browser mode, the error envelope and the contract validator read them.
- `run` returns a plain JSON value. The runner wraps it. Never call `stdout` yourself inside `run`.
- Emit `context.stage(...)` at real boundaries only: `session-check`, `navigate`, `parse`, `download`, `verify`. The runner emits `preflight`, `completed`, `failed`.
- A command with a `.json` contract must appear in that contract's `operations` list; the contract test enforces it.

## 3. Writing a task

A task is a function `(input, portal | runtime) => Promise<JsonValue>` plus a metadata constant. It validates at its boundary with `zod` or explicit checks, then talks to the portal interface.

```ts
export async function listAccountOptions(input: AccountOptionsInput, portal: Pick<BciPymePortal, 'requireAuthenticatedSession' | 'discoverBusinesses' | 'discoverAccounts'>) {
  if (input.businessId.trim() === '') throw invalidInput('business-id must not be empty.', [{ field: '--business-id', expected: 'discovered business ID', discoverWith: '...' }]);
  await portal.requireAuthenticatedSession();
  requireExactDiscoveredOption(await portal.discoverBusinesses(), input.businessId);
  const accounts = await portal.discoverAccounts(input.businessId);
  return { field: 'account-id', dependsOn: { businessId: input.businessId }, options: accounts.map(({ id, label }) => ({ id, label, aliases: [] })) };
}
```

- Take the narrowest portal interface (`Pick<...>`), so a test can pass a three-method fake.
- Validate IDs against a fresh discovery in the same session. Discovery and validation share one parser so they cannot drift.
- Results use portal-native IDs as strings and ISO 8601 dates. No `Date`, `Map`, `Buffer`, browser handle or secret crosses the boundary.
- Writes are split: `prepare` returns a fingerprint; the write requires `--confirm <fingerprint>`, executes once, and verifies live state before reporting.

## 4. Errors

Throw `PortalError` from `packages/runtime/src/errors.ts` with the most specific code. The defaults table fills `safeToRetry`, `loginAttempted`, `remoteMutationPossible`, `reason` and `nextAction`; override only what you know better.

```ts
throw new PortalError('CONTRACT_MISMATCH', 'Expected 1 visible download control, observed 0.', {
  recovery: { stage: 'navigate', contractRef: 'services/bci-pyme/docs/contracts/read-only-browser-flow.md#observed-flow',
    nextCommand: `portales bci-pyme observe cartolas.download --profile ${profile}` },
});
```

- A message states the smallest structural expectation versus observation. It never contains portal text, URLs with query strings, account data or exception internals.
- `PORTAL_CHANGED` is legacy. New code uses `CONTRACT_MISMATCH` for structure, `PROVIDER_ERROR` for an error page, `READINESS_TIMEOUT` for a missing state, `DOWNLOAD_INVALID` for bad bytes, `LOCAL_DEPENDENCY_MISSING` and `BROWSER_LAUNCH_FAILED` for the machine.
- Foreign errors are mapped once, at the command boundary, by a single helper (`services/sii/src/portales-errors.ts` is the model). Unknown errors become `INTERNAL` with a static message.
- Never add a retry to fix an error code. Read-only transport retries exist in one place per service and never cover anything SII or BCI actually answered.

## 5. Portal modules and contracts

Portal code encodes observed facts. Every selector, frame name, readiness marker and count has a dated origin in `services/<service>/docs/contracts/<flow>.md` and a machine twin in `<flow>.json`.

- Before parsing, classify the page (`describe...Page` + `requireBciPageState` in `services/bci-pyme/src/portal/page-state.ts`). "No rows" on a provider error page is a bug.
- Use `requireUnique` / `requireUniqueVisible`. A count of zero or two is a `CONTRACT_MISMATCH`, not a reason to loosen the selector.
- Navigation paths are expressed as step lists (`services/bci-pyme/src/portal/flows/`) when they can be without changing observed waits. Prefer extending a step list over adding a bespoke function.
- To change a contract: run `portales <service> observe <operation>`, review the proposal bundle, edit the JSON and the Markdown with today's date, run `portales contract validate`, then verify once with `portales <service> verify --live`. Never learn selectors from unreviewed live data, and never let code edit the contract.

## 6. Files, artifacts and destinations

Anything downloaded goes through `validateDownloadedFile` (signature, structure, identity labels), then `context.recordArtifact(...)`, then `resolveDestination` + `publishArtifactFile` from `packages/runtime/src/destinations.ts`.

- Results return the complete descriptor: `artifactId`, `sha256`, `byteCount`, `mediaType`, `identifiers`, `documentType`, `validationChecks`, `path`. Never bytes or base64.
- The default location isolates by service, profile, document type and every selected identifier. `--output` must be an existing private directory outside any repository; `--destination` resolves an alias from the private config, never from the repo.
- Downstream code asks `portales artifacts latest --service ... --profile ...`; it does not scan directories.

## 7. Authentication and state

- Credentials exist only in the OS keyring under `cl.bipbop.portales.<service>` with the profile as account. `auth setup` is the only writer and uses hidden prompts. Tasks receive a `SecretReader`, never a writer.
- `auth login` is explicit, makes one attempt, asserts the login breaker first and trips it when the portal rejected submitted credentials. `auth status` and `auth breaker status` are local reads.
- Session material lives under `$XDG_DATA_HOME/portales/<service>/<profile>/` with mode 0600/0700. Run records, locks, snapshots and observation bundles live under `$XDG_STATE_HOME/portales/`. Nothing in either tree is ever committed, logged or returned raw.
- Browser-backed commands take a per-service/profile lock. If a run is active, return `RUN_LOCKED` with its `runId`.

## 8. Tests

- One public-path test per command family through `runCli` with a synthetic portal fake, reading `envelope.result`. See `apps/cli/test/bci-prepare.test.ts` and `apps/cli/test/sii-commands.test.ts`.
- Unit tests only for a regression you hit or a fragile pure boundary: parsers, sanitizers, page-state classification, contract schema.
- Data is invented from scratch. No masked live values. RUTs use obviously fake bodies, labels say "Synthetic".
- `test-setup.ts` points XDG directories at a temp dir, so tests never touch real state. Do not bypass it.
- A passing suite proves nothing about the portal. Live verification is a separate, explicit, read-only step and is reported as done or pending by name.

## 9. Documentation you owe with a change

| You changed | Update |
| --- | --- |
| A command's arguments or output | nothing in Markdown: `describe` and `catalog` are generated. Update `services/<service>/docs/service.md` only for semantics. |
| A selector, wait, frame, or readiness rule | the dated Markdown contract and its JSON twin, same commit |
| A cross-service rule | `CONVENTIONS.md`, and a note in `docs/decisions/` if the choice was between real alternatives |
| A security boundary | `SECURITY.md` or `KEYRING.md` |

## 10. Checks before you say it is done

```bash
npm run build && npm run lint && npm test
portales contract validate
portales doctor <service> --profile <name> --json
portales <service> verify --profile <name> --live   # read-only, when authorized
```

Then the public-repository gate in `AGENTS.md`: inspect the staged diff for anything that came from a live account.
