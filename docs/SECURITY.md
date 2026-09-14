# Security

## Public knowledge, private runs

The repository may contain public URLs, visible generic labels, semantic roles, page relationships, and dated structural observations. It must not contain live identities, businesses, accounts, balances, movements, documents, cookies, tokens, browser profiles, screenshots, traces, HAR files, or copied payloads.

## Authentication

Browser-use agents never type, receive, print, or store credentials. A human or narrowly scoped keyring-backed bootstrap establishes the authenticated browser profile. A playbook begins only after it recognizes the authenticated landing page.

A failed or ambiguous login ends the run. Do not retry or reset a circuit breaker without explicit human review.

## Actions

- `read`: navigation, discovery, or download that does not intentionally alter remote state.
- `write`: reversible remote change.
- `irreversible`: legal declaration, payment, transfer, approval, deletion, or comparable action.

Downloads are remote reads but local writes. Save them privately, validate their content type and signature, and return descriptors rather than contents.

## Fail closed

Stop on unexpected pages, missing recognition evidence, stale references, CAPTCHA, MFA, access denial, rate limiting, account blocks, session expiry, device enrollment, or ambiguous success. Never use repeated clicks as recovery.
