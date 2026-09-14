# Learning a website

## One observation pass

1. Start from a known safe browser state.
2. Capture the page before acting.
3. Record only structural evidence needed to recognize it.
4. Enumerate visible actions and portal-defined options without selecting consequential values.
5. Perform one safe action.
6. Recapture and verify the destination.
7. Stop at authentication, CAPTCHA, MFA, account blocks, rate limits, device enrollment, or an irreversible control.

Do not interleave open-ended coding and repeated browser launches.

## Write the map

Update one page card for each observed page and one flow for the tested path. Mark uncertain or unverified facts explicitly. Never promote an inference to an instruction.

## Deterministic replay

Replay the flow once from a clean state:

- fresh capture at every step;
- exact page recognition before action;
- one action per checkpoint;
- final state verified independently;
- no silent fallback or retry.

If replay fails, preserve the exact failing checkpoint, update the page card, and add only the smallest regression note needed to prevent that failure. Do not add speculative branches.

## When code is justified

Add a helper only when a real run demonstrates that browser-use cannot reliably provide a required primitive, such as hidden-input credential bootstrap, private file validation, or checksum calculation. Keep the browser flow authoritative.
