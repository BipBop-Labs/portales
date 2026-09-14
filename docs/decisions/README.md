# Lightweight decision notes

This repository does **not** require an ADR for routine work. The architecture and conventions documents are the current source of truth and should be edited directly when a rule changes.

Add a decision note only when a choice is:

- cross-cutting across services or surfaces;
- security-sensitive;
- surprising enough that a later agent may undo it;
- costly to reverse;
- a choice between two plausible designs with important trade-offs.

Use filename `YYYY-MM-DD-short-slug.md` to avoid numbering coordination. Keep it under roughly one page:

```markdown
# Decision: <short title>

- Date: YYYY-MM-DD
- Status: accepted | superseded by <link>

## Context
<facts and forces, not a project history>

## Decision
<the rule in direct language>

## Alternatives
<only serious alternatives and why they lost>

## Consequences
<what becomes easier and what obligations remain>
```

Do not create a decision note for a selector, one endpoint, a bug fix, file placement, naming that follows existing conventions, or a decision already obvious from the architecture. Put volatile portal facts in the service's dated contract instead.

When a decision changes, add a new note only if historical rationale remains valuable. Otherwise edit the canonical documentation and let git preserve history.
