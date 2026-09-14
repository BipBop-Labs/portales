# Security and account safety

This is a public repository for tools that handle tax, identity, travel, and banking data. Preventing PII exposure, credential exposure, account blocks, and unintended remote changes is part of correctness.

## Credentials

- The OS keyring is the only credential store.
- Use service `cl.bipbop.portales.<service>` and a user-selected profile account name.
- Capture credentials only through an interactive CLI command with hidden input and store them directly in the keyring.
- Ordinary task runtimes receive a read-only `SecretReader`.
- Never accept secrets through command arguments, environment variables, stdin pipes, config files, source code, logs, telemetry, fixtures, or issue text.
- Never print whether a particular secret field exists beyond a generic “credentials configured/not configured” status.
- Fetch a keyring entry only after non-secret inputs and any warm-session check pass. Do not trigger needless unlock prompts.
- Keep a secret in memory only for the single authentication attempt. Do not cache it in application state.

Credentials include passwords, PINs, API tokens, refresh tokens, client secrets, private keys, certificate passphrases, recovery codes, one-time codes, and challenge answers.

## Sessions

Persist only the minimum cookies or browser storage required to resume a session. Store session files outside the repository with user-only permissions. Never mix profiles or services in one session file.

A session record must identify its service and profile without embedding the credential. Logout removes local session material even if server-side logout fails. Expiry is surfaced explicitly and never causes implicit re-login.

Treat cookies, CSRF tokens, device identifiers, and browser storage as secrets even if they are short-lived.

## Authentication safety

- Validate usernames, RUTs, account identifiers, and check digits locally before touching the login page.
- Make one login attempt per explicit command.
- Never retry failed authentication automatically.
- Stop on CAPTCHA, MFA, device approval, authorization denial, rate limit, account block, or changed login flow.
- One-time codes require a dedicated user-mediated flow and must never be persisted. Do not design that flow until a real service requires it.
- Public tasks never log in as a side effect.

## PII and financial data

Curate outputs to the fields needed by the operation. Prefer dropping an unbounded raw payload over maintaining an incomplete PII denylist.

Data received from any user, client, chat, email, local file, screenshot, document, browser session, or live account must never be used as repository content, even after partial redaction. Do not copy it into examples, fixtures, snapshots, traces, tests, documentation, issues, comments, or commit messages. Build examples from obviously synthetic identities and values created from scratch for the test case.

Never place credentials, session material, full identity data, account numbers, balances, transaction descriptions, document bodies, or free text in audit logs. Service docs must identify which result fields are sensitive and whether exposing them to an agent is necessary.

Committed fixtures use synthetic values only. Structural fidelity is required; real data is forbidden.

## Audit receipts

Audit state-touching operations with minimal JSONL receipts such as:

- timestamp;
- service and operation;
- profile or redacted account fingerprint;
- effect;
- result code;
- duration;
- remote identifier for a write, when safe.

Before writing, recursively remove keys whose normalized name contains `password`, `passcode`, `pin`, `clave`, `secret`, `token`, `cookie`, `authorization`, or `certificate`. Redaction is defense in depth; sensitive values should not enter the audit object in the first place.

An audit failure must not silently turn a failed write into success. Define the task's policy explicitly: reads may degrade; destructive operations should fail closed unless the remote action has already happened, in which case return `REMOTE_STATE_AMBIGUOUS` and reconcile live state.

## Downloads

Write documents through `FileSink` to an explicit destination. Use restrictive permissions. Validate media type, file signature, expected identity, and expected business state before reporting success.

Return a descriptor rather than bytes or base64. The caller controls retention. Temporary files must be deleted after delivery or moved to an approved persistent system.

## Logging and diagnostics

Never log request headers or bodies wholesale. Use allowlisted diagnostic fields. Browser screenshots and traces can contain credentials and account data; collect only when necessary, store temporarily, redact before sharing, and never commit them.

## Incident behavior

If a credential, cookie, token, or real fixture is exposed:

1. Stop work and prevent further distribution.
2. Revoke or rotate the affected credential/session through the provider.
3. Remove the material from the working tree and history before further pushes.
4. Verify no logs, artifacts, caches, or CI outputs retain it.
5. Document the prevention rule without reproducing the secret.
