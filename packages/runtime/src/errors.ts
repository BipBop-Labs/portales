/** Cross-service error taxonomy. Every failure that crosses the task boundary is a `PortalError`
 *  with a stable code and bounded recovery metadata; the CLI wraps it in the versioned error
 *  envelope. `PORTAL_CHANGED` remains accepted as a legacy alias of `CONTRACT_MISMATCH` and is
 *  reserved for a real structural mismatch, never for local, transport, or provider failures. */
export type PortalErrorCode =
  | 'INVALID_INPUT'
  | 'CONFIRMATION_REQUIRED'
  | 'CREDENTIALS_NOT_CONFIGURED'
  | 'CREDENTIALS_INVALID'
  | 'KEYRING_LOCKED'
  | 'KEYRING_UNAVAILABLE'
  | 'LOGIN_FAILED'
  | 'NOT_AUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'ADDITIONAL_AUTH_REQUIRED'
  | 'AUTHORIZATION_DENIED'
  | 'RATE_LIMITED'
  | 'ACCOUNT_BLOCKED'
  | 'PORTAL_CHANGED'
  | 'CONTRACT_MISMATCH'
  | 'REMOTE_STATE_AMBIGUOUS'
  | 'LOCAL_DEPENDENCY_MISSING'
  | 'BROWSER_LAUNCH_FAILED'
  | 'PROVIDER_ERROR'
  | 'READINESS_TIMEOUT'
  | 'DOWNLOAD_INVALID'
  | 'RUN_LOCKED'
  | 'SNAPSHOT_EXPIRED'
  | 'SNAPSHOT_STALE'
  | 'UNSUPPORTED_CAPABILITY'
  | 'STALE_BUILD'
  | 'INTERNAL';

/** Static lifecycle stages. Events on STDERR and run records use only these names. */
export type Stage =
  | 'preflight'
  | 'session-check'
  | 'navigate'
  | 'parse'
  | 'download'
  | 'verify'
  | 'completed'
  | 'failed';

export interface RecoveryMetadata {
  /** Stage that was executing when the failure surfaced. */
  stage?: Stage;
  /** Static, allowlisted reason token (never portal text). */
  reason?: string;
  lastCompletedStage?: Stage;
  /** Static human next step. */
  nextAction?: string;
  /** Exact public command to run next, when one applies. */
  nextCommand?: string;
  /** Contract document (and anchor) that defines the expected behaviour. */
  contractRef?: string;
  safeToRetry?: boolean;
  loginAttempted?: boolean;
  remoteMutationPossible?: boolean;
  contractVersion?: string;
  /** Run that currently holds the lock (`RUN_LOCKED` only). */
  activeRunId?: string;
}

/** One actionable validation problem. `discoverWith` names the exact command that lists valid values. */
export interface ValidationDetail {
  field: string;
  expected: string;
  received?: string;
  discoverWith?: string;
}

export interface PortalErrorOptions {
  recovery?: RecoveryMetadata;
  validation?: ValidationDetail[];
  cause?: unknown;
}

const defaults: Record<PortalErrorCode, RecoveryMetadata> = {
  INVALID_INPUT: { safeToRetry: true, loginAttempted: false, remoteMutationPossible: false, reason: 'invalid-input', nextAction: 'Correct the input locally before retrying.' },
  CONFIRMATION_REQUIRED: { safeToRetry: true, loginAttempted: false, remoteMutationPossible: false, reason: 'confirmation-required', nextAction: 'Review the preview and pass the operation-specific --confirm value.' },
  CREDENTIALS_NOT_CONFIGURED: { safeToRetry: true, loginAttempted: false, remoteMutationPossible: false, reason: 'credentials-not-configured', nextAction: 'Run the interactive auth setup for this profile.' },
  CREDENTIALS_INVALID: { safeToRetry: false, loginAttempted: false, remoteMutationPossible: false, reason: 'credentials-invalid', nextAction: 'Re-run auth setup with a valid credential bundle.' },
  KEYRING_LOCKED: { safeToRetry: true, loginAttempted: false, remoteMutationPossible: false, reason: 'keyring-locked', nextAction: 'Unlock the OS keyring and retry.' },
  KEYRING_UNAVAILABLE: { safeToRetry: true, loginAttempted: false, remoteMutationPossible: false, reason: 'keyring-unavailable', nextAction: 'Start the Secret Service (keyring) daemon; run portales doctor.' },
  LOGIN_FAILED: { safeToRetry: false, loginAttempted: true, remoteMutationPossible: false, reason: 'login-failed', nextAction: 'Do not retry automatically. Inspect auth status and the breaker before a human decides.' },
  NOT_AUTHENTICATED: { safeToRetry: false, loginAttempted: false, remoteMutationPossible: false, reason: 'not-authenticated', nextAction: 'Run the explicit auth login command for this profile.' },
  SESSION_EXPIRED: { safeToRetry: false, loginAttempted: false, remoteMutationPossible: false, reason: 'session-expired', nextAction: 'Run the explicit auth login command for this profile.' },
  ADDITIONAL_AUTH_REQUIRED: { safeToRetry: false, loginAttempted: true, remoteMutationPossible: false, reason: 'additional-auth-required', nextAction: 'A human must complete the additional verification. Do not retry.' },
  AUTHORIZATION_DENIED: { safeToRetry: false, loginAttempted: false, remoteMutationPossible: false, reason: 'authorization-denied', nextAction: 'The account lacks permission. Stop.' },
  RATE_LIMITED: { safeToRetry: false, loginAttempted: false, remoteMutationPossible: false, reason: 'rate-limited', nextAction: 'Stop remote attempts. Wait for the provider window before a human resumes.' },
  ACCOUNT_BLOCKED: { safeToRetry: false, loginAttempted: false, remoteMutationPossible: false, reason: 'account-blocked', nextAction: 'Stop. Requires human/provider resolution.' },
  PORTAL_CHANGED: { safeToRetry: false, loginAttempted: false, remoteMutationPossible: false, reason: 'contract-mismatch', nextAction: 'Do not broaden selectors or retry. Observe the operation and propose a contract diff.' },
  CONTRACT_MISMATCH: { safeToRetry: false, loginAttempted: false, remoteMutationPossible: false, reason: 'contract-mismatch', nextAction: 'Do not broaden selectors or retry. Observe the operation and propose a contract diff.' },
  REMOTE_STATE_AMBIGUOUS: { safeToRetry: false, loginAttempted: false, remoteMutationPossible: true, reason: 'remote-state-ambiguous', nextAction: 'Reconcile observable state with an authorized read. Never repeat the mutation.' },
  LOCAL_DEPENDENCY_MISSING: { safeToRetry: true, loginAttempted: false, remoteMutationPossible: false, reason: 'local-dependency-missing', nextAction: 'Install the missing local dependency; run portales doctor.' },
  BROWSER_LAUNCH_FAILED: { safeToRetry: true, loginAttempted: false, remoteMutationPossible: false, reason: 'browser-launch-failed', nextAction: 'Check Chrome/Xvfb availability with portales doctor.' },
  PROVIDER_ERROR: { safeToRetry: false, loginAttempted: false, remoteMutationPossible: false, reason: 'provider-error-page', nextAction: 'The provider served an error page. Check availability before retrying; do not repeat login.' },
  READINESS_TIMEOUT: { safeToRetry: false, loginAttempted: false, remoteMutationPossible: false, reason: 'readiness-timeout', nextAction: 'The expected page state did not appear in time. Check provider availability; do not add delays.' },
  DOWNLOAD_INVALID: { safeToRetry: false, loginAttempted: false, remoteMutationPossible: false, reason: 'download-validation-failed', nextAction: 'The downloaded bytes failed validation. Inspect the artifact locally; do not trust the file.' },
  RUN_LOCKED: { safeToRetry: true, loginAttempted: false, remoteMutationPossible: false, reason: 'run-locked', nextAction: 'Another run holds this service/profile. Wait for it or inspect it with portales runs show <run-id>.' },
  SNAPSHOT_EXPIRED: { safeToRetry: true, loginAttempted: false, remoteMutationPossible: false, reason: 'snapshot-expired', nextAction: 'Re-run the prepare command to obtain a fresh snapshot.' },
  SNAPSHOT_STALE: { safeToRetry: true, loginAttempted: false, remoteMutationPossible: false, reason: 'snapshot-stale', nextAction: 'Portal or account state changed since prepare. Re-run prepare and review the differences.' },
  UNSUPPORTED_CAPABILITY: { safeToRetry: false, loginAttempted: false, remoteMutationPossible: false, reason: 'unsupported-capability', nextAction: 'This operation is not implemented. See portales catalog --json for supported operations.' },
  STALE_BUILD: { safeToRetry: true, loginAttempted: false, remoteMutationPossible: false, reason: 'stale-build', nextAction: 'Rebuild or update the installation; run portales doctor.' },
  INTERNAL: { safeToRetry: false, loginAttempted: false, remoteMutationPossible: false, reason: 'internal-failure', nextAction: 'Inspect the run record with portales runs show <run-id>.' },
};

export class PortalError extends Error {
  readonly retryable = false;
  readonly recovery: RecoveryMetadata;
  readonly validation: ValidationDetail[] | undefined;

  constructor(
    readonly code: PortalErrorCode,
    message: string,
    options: PortalErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PortalError';
    this.recovery = { ...defaults[code], ...options.recovery };
    this.validation = options.validation;
  }

  /** Returns a copy carrying additional recovery metadata without losing the original. */
  withRecovery(recovery: RecoveryMetadata): PortalError {
    return new PortalError(this.code, this.message, {
      recovery: { ...this.recovery, ...recovery },
      ...(this.validation === undefined ? {} : { validation: this.validation }),
    });
  }
}

/** Builds the actionable validation error the CLI and tasks share. */
export function invalidInput(message: string, details: ValidationDetail[], recovery: RecoveryMetadata = {}): PortalError {
  return new PortalError('INVALID_INPUT', message, { validation: details, recovery });
}

export function exitCodeFor(code: PortalErrorCode): number {
  switch (code) {
    case 'CONFIRMATION_REQUIRED': return 8;
    case 'INVALID_INPUT':
    case 'LOCAL_DEPENDENCY_MISSING':
    case 'SNAPSHOT_EXPIRED':
    case 'SNAPSHOT_STALE':
    case 'UNSUPPORTED_CAPABILITY': return 2;
    case 'NOT_AUTHENTICATED':
    case 'SESSION_EXPIRED': return 3;
    case 'LOGIN_FAILED':
    case 'ADDITIONAL_AUTH_REQUIRED':
    case 'CREDENTIALS_INVALID':
    case 'CREDENTIALS_NOT_CONFIGURED':
    case 'KEYRING_LOCKED':
    case 'KEYRING_UNAVAILABLE': return 4;
    case 'AUTHORIZATION_DENIED': return 5;
    case 'ACCOUNT_BLOCKED':
    case 'RATE_LIMITED': return 6;
    case 'PORTAL_CHANGED':
    case 'CONTRACT_MISMATCH':
    case 'DOWNLOAD_INVALID':
    case 'REMOTE_STATE_AMBIGUOUS': return 7;
    case 'PROVIDER_ERROR':
    case 'READINESS_TIMEOUT': return 9;
    case 'RUN_LOCKED': return 10;
    case 'BROWSER_LAUNCH_FAILED':
    case 'STALE_BUILD':
    case 'INTERNAL': return 1;
  }
}

/** Converts an arbitrary thrown value into a typed error without leaking its message. */
export function asPortalError(error: unknown, fallback: PortalErrorCode = 'INTERNAL'): PortalError {
  if (error instanceof PortalError) return error;
  if (typeof error === 'object' && error !== null) {
    const item = error as { code?: unknown; name?: unknown; message?: unknown };
    if (item.name === 'TimeoutError') {
      return new PortalError('READINESS_TIMEOUT', 'The expected page state did not appear within the readiness budget.', { cause: error });
    }
    if (item.code === 'PORTAL_CHANGED' && item.name === 'DownloadValidationError') {
      return new PortalError('DOWNLOAD_INVALID', typeof item.message === 'string' ? item.message : 'Downloaded content failed validation.', { cause: error });
    }
    if (typeof item.message === 'string' && /Executable doesn't exist|Failed to launch|browserType\.launch|xvfb-run|Target page, context or browser has been closed/iu.test(item.message)) {
      return new PortalError('BROWSER_LAUNCH_FAILED', 'The browser could not be launched or was closed unexpectedly.', { cause: error });
    }
    if (typeof item.message === 'string' && /ECONNREFUSED|ECONNRESET|ENOTFOUND|net::ERR_/u.test(item.message)) {
      return new PortalError('PROVIDER_ERROR', 'The provider could not be reached.', { cause: error });
    }
  }
  return new PortalError(fallback, 'The operation could not be completed safely.', { cause: error });
}
