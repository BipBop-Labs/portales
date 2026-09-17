# Decision: machine-checkable contracts, observation mode, and no self-healing

- Date: 2026-09-17
- Status: accepted

## Context

Contracts were dated Markdown prose beside adapters that hard-coded the same facts. When a portal changed, the agent got `PORTAL_CHANGED`, opened a browser by hand, and repaired selectors in code. Tools that heal selectors automatically at runtime exist (Stagehand's cached actions, self-healing locator lists), but they either send live DOM to a model provider or change behavior in production without review, and both are unacceptable for a bank or tax portal.

## Decision

Each browser contract has a JSON twin (`services/<service>/docs/contracts/<flow>.json`, schema in `packages/runtime/src/contracts.ts`) recording observation date, expected page states with route fragments, frame names, readiness markers, control roles and cardinalities, optional aria snapshots with values stripped, flow steps, success, stop and branch conditions. Adapters classify the page against those states before parsing and report the smallest structural diff as `CONTRACT_MISMATCH`. Flows are expressed as declarative step lists interpreted by one executor per service where that is a strict refactor of observed behavior. `portales <service> observe <operation>` captures only allowlisted structural evidence into a private bundle and a proposal that separates facts from hypotheses. `portales contract check <run-id>` scaffolds the review. The repair loop is: observe, propose diff, agent review, local tests, one safe live verification, dated contract update. The tool never broadens selectors, adds delays, retries authentication, mutates a contract, learns from unreviewed live data, commits or pushes.

## Alternatives

- Adopt Stagehand or a self-healing test tool: rejected; runtime model calls with live DOM, an API key as a cron dependency, and unreviewed production changes.
- Fully autonomous browser agents (browser-use, Skyvern): rejected; non-deterministic, slow, and unsuited to financial mutations.
- Keep prose-only contracts: rejected; not checkable, and the diff on mismatch cannot be computed.

## Consequences

Exploration uses an agent-driven browser (Playwright MCP or Chrome DevTools MCP); execution stays deterministic Playwright. Contract JSON is validated in tests and by `portales contract validate`. Some BCI functions still carry their selectors in code because migrating them to step lists would have changed observed waits; they are listed in the Markdown contract as pending.
