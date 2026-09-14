export type PortalErrorCode =
  | 'INVALID_INPUT'
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
  | 'REMOTE_STATE_AMBIGUOUS';

export class PortalError extends Error {
  readonly retryable = false;

  constructor(
    readonly code: PortalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PortalError';
  }
}
