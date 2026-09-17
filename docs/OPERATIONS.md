# Operate, diagnose, repair

Portales grows through use: a real task establishes a need, the agent implements or repairs a public command, and the verified capability becomes available to later tasks. The agent performing the task owns the outcome, including diagnosis and integration of any delegated work. Reuse the existing service command before adding another interface. Keep improvements proportional to the operation needed now.

## Working loop

1. Explore first: read the repository conventions, existing command and service code, and dated contract. Find the supported command and discover constrained values through its `options` command. Identify the intended result and existing authorization for the operation. Understand the actual flow before designing an extension.
2. Run the public command with the minimum remote work. Authentication stays explicit. Inspect its result, STDERR, and exit status; compare success with observable portal state.
3. On failure, stop remote execution where required. Inspect existing evidence and code before making another request. Separate local setup, authentication, session state, portal contract, and result-verification failures.
4. Fix the smallest responsible boundary using existing repository conventions and interfaces. For a new flow or changed portal behavior, observe the exact operation in the real browser before implementing selectors or replay. Never brute-force endpoints, fields, or identifiers to discover a contract. Update the dated structural contract. If evidence is missing, add only the diagnostic context needed to explain this failure.
5. Run relevant local checks. Verify the repaired public command against the live portal only within the existing authorization and stop rules. An ambiguous mutation requires state reconciliation, never another submission to see whether the fix works.
6. Leave the reusable command and useful lessons for the next agent in the repository. Improve existing guidance with what made exploration, implementation, diagnosis, or verification more effective. Report what worked, what was verified live, and any remaining blocker. Local checks alone cannot close an unverified portal operation.

A temporary workaround is not the maintained capability. Bring useful behavior back into the service task and public CLI before declaring the integration complete. Do not add unrelated commands, general frameworks, or exhaustive tests along the way.

## Diagnostics available (2026-09-17)

Every service command writes a private, bounded run record and lifecycle events. Start with these before reading code:

```bash
portales doctor [service] --profile <name> --json   # local readiness; never contacts a portal
portales runs list --service <service> --json       # recent runs, newest first
portales runs show <run-id> --json                  # stage timings, typed error, recovery metadata, artifact descriptors
portales artifacts list --service <service> --profile <name> --json
portales artifacts verify <artifact-id> --json      # re-check size, SHA-256, and permissions on disk
portales contract check <run-id> --json             # sanitized observation scaffold for a failed run, outside the repository
portales <service> observe <operation> --profile <name> --json   # read-only structural evidence + contract-diff proposal
portales <service> verify --live --profile <name>   # opt-in, read-only live check against the contract
```

Run records live under `$XDG_STATE_HOME/portales/runs` (0600, bounded retention). They contain stage names, durations, typed error codes, recovery metadata, contract version, browser mode, and artifact descriptors. They never contain credentials, cookies, HTML, request bodies, account data, or document contents. Raw STDERR is JSON lines for every event and error; unexpected process crashes may still print plain text.

The error envelope already carries `nextCommand` and `contractRef`; run that command before searching source. `version --json` and `doctor` report a stale build; rebuild with `npm run update` (never during a portal operation).

## Adding diagnostic context

When a real failure cannot be explained from current output, add bounded events at the responsible boundary. Use an explicit allowlist: generated run identifier, timestamp, service, operation, static stage name, duration, typed error code, and a static next-step hint. Include only fields needed for that investigation. Keep machine results on STDOUT and diagnostics on STDERR.

Never serialize task inputs, results, arbitrary exception objects, portal text, URLs with query strings, headers, bodies, credentials, or session state into a diagnostic event. Prefer a static stage such as `session-check` or `result-verification` over raw browser state. A diagnostic must distinguish the last completed stage from the failed stage when that distinction determines whether a remote action may already have happened.

If persistent logging is introduced for a demonstrated need, keep it outside the repository with private directory/file permissions, bounded retention, and a documented location and inspection command. Document its failure policy; a logging failure after a remote write must never cause a retry or obscure the uncertain outcome. Add no telemetry service, log framework, or generic replay system without a concrete operational requirement.

## Recovery boundaries

| Code | Next step |
| --- | --- |
| `INVALID_INPUT`, `LOCAL_DEPENDENCY_MISSING`, `SNAPSHOT_*` | Correct locally; follow `validation[].discoverWith` or re-run `prepare`. `doctor` names missing tools. |
| `NOT_AUTHENTICATED`, `SESSION_EXPIRED` | Run the explicit `auth login`; never log in as a side effect of repair. |
| `LOGIN_FAILED`, `ADDITIONAL_AUTH_REQUIRED`, `AUTHORIZATION_DENIED`, `ACCOUNT_BLOCKED`, `RATE_LIMITED` | Stop remote attempts. Check `auth breaker status`; a human clears the breaker. |
| `BROWSER_LAUNCH_FAILED`, `PROVIDER_ERROR`, `READINESS_TIMEOUT` | Not a contract problem. Check `doctor`, provider availability, and the run record; do not add delays or broaden selectors. |
| `CONTRACT_MISMATCH` | Read the smallest structural diff in the error, run `observe` for the operation, review the proposed contract diff, run local tests, verify once live, then update the dated contract. Never auto-apply. |
| `DOWNLOAD_INVALID` | Inspect the artifact locally with `artifacts verify`; do not trust the file. |
| `REMOTE_STATE_AMBIGUOUS` | Reconcile with an authorized read. Never repeat the mutation. |
| `RUN_LOCKED` | Inspect `activeRunId` with `runs show`; wait or stop that run. |
| Live verification unavailable | Finish safe local work and state precisely what remains unverified. |

## Durable learning and tests

Record only reusable structural knowledge: dated behavior, the failed assumption, the corrected success/stop condition, and the public command used to verify it without private arguments or outputs. Keep service knowledge in the service documentation and contract. Avoid a parallel incident database or copied execution transcript.

Teach the investigation method as well as the resulting contract. When a discovery will help another agent, explain where to find authoritative evidence, what observation distinguished competing explanations, which existing tool or convention simplified the implementation, and how to verify with the fewest safe calls. Record a failed approach only when its reason for failure prevents a likely repeat. Consult these lessons before exploring again, and correct stale guidance when new evidence contradicts it. Promote a lesson to shared documentation only when it applies across services; no separate learning framework or per-task report is required.

Add a regression test when it reproduces an actual failure, or a small check for an identified fragile safety boundary. Prefer the useful public path and wholly synthetic data. Zero new tests is a valid decision. Preserve existing safety checks and run checks appropriate to the changed code; do not use test count or mock coverage as evidence that the portal works.
