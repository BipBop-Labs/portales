import { PortalError } from './errors.js';
import { requireSafeProfile } from './login-breaker.js';
import { SecretServiceError, type SecretReader } from './secret-service.js';

/** A service's single observed login interaction. It reports `submitted` right after the one
 *  credential submission and `accepted` once the portal positively established authentication. */
export interface OneShotLoginPortal<Credentials> {
  authenticate(credentials: Credentials, submitted: () => void, accepted: () => void): Promise<void>;
}

interface Breaker {
  assertClear(profile: string): Promise<void> | void;
  trip(profile: string): Promise<void> | void;
}

export interface OneShotLogin<Credentials, Stage extends string> {
  profile: string;
  /** Exact Secret Service attribute owned by the service specification. */
  keyringService: string;
  stage: Stage;
  parse(encoded: string): Credentials;
  secrets: SecretReader;
  breaker: Breaker;
  portal: OneShotLoginPortal<Credentials>;
  authState?: { recordAuthenticated(profile: string, stage: Stage): Promise<void> | void };
}

/** Breaker check, keyring read, exactly one attempt; trips the breaker when a submitted login
 *  was rejected or never accepted. Returns only non-secret status. */
export async function loginOnce<Credentials, Stage extends string>(login: OneShotLogin<Credentials, Stage>) {
  requireSafeProfile(login.profile);
  await login.breaker.assertClear(login.profile);
  let encoded: string;
  try {
    encoded = await login.secrets.read({ service: login.keyringService, account: login.profile });
  } catch (error: unknown) {
    if (error instanceof SecretServiceError) throw new PortalError(error.code, 'Credentials could not be read from Secret Service.');
    throw error;
  }
  const credentials = login.parse(encoded);
  const attempt = { submitted: false, accepted: false };
  try {
    await login.portal.authenticate(
      credentials,
      () => { attempt.submitted = true; },
      () => { attempt.accepted = true; },
    );
  } catch (error: unknown) {
    if (attempt.submitted && !attempt.accepted) await login.breaker.trip(login.profile);
    throw error;
  }
  if (!attempt.accepted) {
    if (attempt.submitted) await login.breaker.trip(login.profile);
    throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'The login result was not accepted by the portal.');
  }
  await login.authState?.recordAuthenticated(login.profile, login.stage);
  return { profile: login.profile, authenticated: true as const, lastAuthenticatedStage: login.stage };
}
