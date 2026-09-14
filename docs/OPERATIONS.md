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

## Diagnostics available today

The unified CLI exposes JSON results on STDOUT and errors on STDERR with an exit status. Some flows also emit progress on STDERR. There is currently no unified persistent run log, run-history command, or general `doctor`/`debug` command. Do not assume that diagnostic history exists after a failure.

Use the existing local tools first:

```bash
rg --files apps/cli services packages/runtime
rg -n 'PORTAL_CHANGED|SESSION_EXPIRED' apps/cli/src services
npm run build
npm run lint
```

For a relevant existing test, run its file with `npm test -- <test-file>`. Choose the file from the source tree; do not generate a new suite merely to reproduce the module structure.

When an authorized command needs retained output, capture it in a private temporary directory outside the checkout. This example uses the existing local catalog command and needs no portal session:

```bash
umask 077
run_dir=$(mktemp -d /tmp/portales-run.XXXXXX)
node dist/apps/cli/src/main.js bci-pyme cartolas options --profile default \
  >"$run_dir/result.json" 2>"$run_dir/diagnostics.jsonl"
run_status=$?
printf '%s\n' "$run_status" >"$run_dir/exit-code"
```

The build must already exist. Raw STDERR is not guaranteed to be JSONL for unexpected process failures. Inspect captures locally; a live command's result can contain private account data. Never attach captures to a commit, issue, or PR. Remove them when the investigation is complete. Do not enable broad browser/network debug dumps to compensate for missing diagnostics.

## Adding diagnostic context

When a real failure cannot be explained from current output, add bounded events at the responsible boundary. Use an explicit allowlist: generated run identifier, timestamp, service, operation, static stage name, duration, typed error code, and a static next-step hint. Include only fields needed for that investigation. Keep machine results on STDOUT and diagnostics on STDERR.

Never serialize task inputs, results, arbitrary exception objects, portal text, URLs with query strings, headers, bodies, credentials, or session state into a diagnostic event. Prefer a static stage such as `session-check` or `result-verification` over raw browser state. A diagnostic must distinguish the last completed stage from the failed stage when that distinction determines whether a remote action may already have happened.

If persistent logging is introduced for a demonstrated need, keep it outside the repository with private directory/file permissions, bounded retention, and a documented location and inspection command. Document its failure policy; a logging failure after a remote write must never cause a retry or obscure the uncertain outcome. Add no telemetry service, log framework, or generic replay system without a concrete operational requirement.

## Recovery boundaries

| Failure | Next step |
| --- | --- |
| Invalid local input or missing dependency | Correct it locally before remote execution. Use `options` for portal-defined choices. |
| Missing or expired session | Surface the need for explicit authentication; never log in as a side effect of repair. |
| Authentication failure, CAPTCHA, authorization denial, block, or rate limit | Stop remote attempts. Keep local diagnosis moving; require the documented human/provider resolution before resuming. Never reset a breaker just to test a patch. |
| Changed selector, response, or readiness condition | Return `PORTAL_CHANGED`, observe the supported browser flow within the safety boundary, then repair the contract and adapter. |
| Ambiguous write result | Reconcile observable state using an authorized read. Do not repeat the mutation. |
| Live verification unavailable | Finish safe local work and state precisely what remains unverified and what is needed to resume. |

## Durable learning and tests

Record only reusable structural knowledge: dated behavior, the failed assumption, the corrected success/stop condition, and the public command used to verify it without private arguments or outputs. Keep service knowledge in the service documentation and contract. Avoid a parallel incident database or copied execution transcript.

Teach the investigation method as well as the resulting contract. When a discovery will help another agent, explain where to find authoritative evidence, what observation distinguished competing explanations, which existing tool or convention simplified the implementation, and how to verify with the fewest safe calls. Record a failed approach only when its reason for failure prevents a likely repeat. Consult these lessons before exploring again, and correct stale guidance when new evidence contradicts it. Promote a lesson to shared documentation only when it applies across services; no separate learning framework or per-task report is required.

Add a regression test when it reproduces an actual failure, or a small check for an identified fragile safety boundary. Prefer the useful public path and wholly synthetic data. Zero new tests is a valid decision. Preserve existing safety checks and run checks appropriate to the changed code; do not use test count or mock coverage as evidence that the portal works.
