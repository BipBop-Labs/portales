# Markdown conventions

## Website entry point

Every website starts at `websites/<site>/AGENTS.md`. It contains:

- scope and forbidden areas;
- authentication boundary;
- global stop conditions;
- links to every supported flow and page;
- runtime-data handling rules.

## Page card

Every `pages/<page>.md` uses these sections:

1. **Purpose**
2. **Recognition evidence**
3. **Available actions**
4. **Runtime options**
5. **Transitions**
6. **Stop conditions**
7. **Related pages and flows**

Recognition evidence should use visible labels, semantic roles, URL fragments, and frame identity only when directly observed. Avoid brittle CSS classes.

## Flow

Every `flows/<flow>.md` declares:

- effect: `read`, `write`, or `irreversible`;
- prerequisites and authentication state;
- private input and output;
- ordered steps linking to page cards;
- final verification;
- stop and recovery behavior.

Use `site resource action` as a stable name, for example `bci-pyme cartolas download`. It names a playbook; it does not imply a custom CLI exists.

## Browser-use loop

For every step:

```text
capture -> recognize -> act once -> recapture -> verify
```

A state change invalidates previous element references. Escalate from semantic action to another input route only after a verified no-op. Never repeat an action merely because the first capture was slow to update.

## Links, language, and examples

- Use relative links.
- Keep one source of truth for each page detail.
- Flows link to page cards instead of copying selectors.
- Use portal-native labels when translation would reduce precision.
- Examples must be invented and obviously synthetic.
- Do not use tables when a short list is clearer for an agent.
