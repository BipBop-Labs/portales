import { PortalError, asPortalError, type PortalErrorCode, type RecoveryMetadata, type ValidationDetail } from '../../../packages/runtime/src/errors.js';
import {
  CredentialNotFoundError,
  LoginFailedError,
  NotAuthenticatedError,
  RateLimitError,
  SessionExpiredError,
  SiiError,
  UnexpectedResponseError,
  ValidationError,
  Www2SessionError,
} from './errors/index.js';

export const SII_DOCS = 'docs/SII.md';

interface MapOptions {
  profile: string;
  /** Contract section for this operation. */
  contractRef: string;
  /** Validation detail attached to a `ValidationError`. */
  validation?: ValidationDetail[];
  /** Discovery command suggested for a `ValidationError`. */
  discoverWith?: string;
}

/** Maps a SII domain error to the shared taxonomy at the command boundary. Messages stay verbatim. */
export function toPortalError(error: unknown, options: MapOptions): PortalError {
  if (error instanceof PortalError) return error;
  const login = `portales sii auth login --profile ${options.profile}`;
  const base: RecoveryMetadata = { contractRef: options.contractRef };
  const build = (code: PortalErrorCode, message: string, recovery: RecoveryMetadata, validation?: ValidationDetail[]) =>
    new PortalError(code, message, { recovery: { ...base, ...recovery }, ...(validation === undefined ? {} : { validation }), cause: error });
  if (error instanceof SessionExpiredError || error instanceof Www2SessionError) {
    return build('SESSION_EXPIRED', error.message, { stage: 'session-check', nextCommand: login });
  }
  if (error instanceof NotAuthenticatedError) {
    return build('NOT_AUTHENTICATED', error.message, { stage: 'session-check', nextCommand: login });
  }
  if (error instanceof LoginFailedError) {
    return build('LOGIN_FAILED', error.message, { stage: 'navigate', loginAttempted: true, nextCommand: `portales sii auth breaker status --profile ${options.profile} --json` });
  }
  if (error instanceof RateLimitError) {
    return build('RATE_LIMITED', error.message, { stage: 'navigate' });
  }
  if (error instanceof CredentialNotFoundError) {
    return build('CREDENTIALS_NOT_CONFIGURED', error.message, { nextCommand: `portales sii auth setup --profile ${options.profile}` });
  }
  if (error instanceof ValidationError) {
    return build('INVALID_INPUT', error.message, {
      ...(options.discoverWith === undefined ? {} : { nextCommand: options.discoverWith }),
    }, options.validation ?? [{ field: 'input', expected: error.message, ...(options.discoverWith === undefined ? {} : { discoverWith: options.discoverWith }) }]);
  }
  if (error instanceof UnexpectedResponseError) {
    return build('PROVIDER_ERROR', error.message, { stage: 'parse', lastCompletedStage: 'navigate' });
  }
  if (error instanceof SiiError) {
    // Portal-shaped rejections (Rcv/Dte/Bte/Representacion/...): SII answered, but not as recorded.
    return build('CONTRACT_MISMATCH', error.message, { stage: 'parse', lastCompletedStage: 'navigate', nextAction: 'SII answered outside the recorded contract. Observe the operation before changing the adapter; do not retry.' });
  }
  // Browser launch, transport, and timeout failures are classified by the shared runtime.
  const shared = asPortalError(error);
  if (shared.code !== 'INTERNAL') return shared.withRecovery(base);
  return new PortalError('INTERNAL', 'The SII operation could not be completed safely.', { recovery: base, cause: error });
}

/** Runs one SII task and converts its failure at the boundary. */
export async function guardSii<T>(work: () => Promise<T>, options: MapOptions): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    throw toPortalError(error, options);
  }
}
