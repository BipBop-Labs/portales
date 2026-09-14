import { isValidRut } from '../rut.js';
import { SecretServiceError, type SecretReader } from '../../../../packages/runtime/src/secret-service.js';
import { PortalError } from '../errors.js';
import { requireSafeProfile } from '../auth/login-breaker.js';

export interface BciCredentials { rut: string; password: string }
export interface LoginPortal {
  authenticate(
    credentials: BciCredentials,
    submitted: () => void,
    accepted: () => void,
  ): Promise<void>;
}
interface Breaker {
  assertClear(profile: string): Promise<void> | void;
  trip(profile: string): Promise<void> | void;
}
interface LoginDependencies { secrets: SecretReader; breaker: Breaker; portal: LoginPortal }

export function parseCredentials(value: string): BciCredentials {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new PortalError('CREDENTIALS_INVALID', 'The configured credentials are invalid.'); }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new PortalError('CREDENTIALS_INVALID', 'The configured credentials are invalid.');
  }
  const item = parsed as Record<string, unknown>;
  if (Object.keys(item).length !== 3 || item.version !== 1
    || typeof item.rut !== 'string' || !isValidRut(item.rut)
    || typeof item.password !== 'string' || item.password.length === 0) {
    throw new PortalError('CREDENTIALS_INVALID', 'The configured credentials are invalid.');
  }
  return { rut: item.rut, password: item.password };
}

/** Makes one explicit BCI login attempt and returns only non-secret session status. */
export async function loginBciPyme(
  input: { profile: string },
  dependencies: LoginDependencies,
) {
  requireSafeProfile(input.profile);
  await dependencies.breaker.assertClear(input.profile);
  let encoded: string;
  try {
    encoded = await dependencies.secrets.read({
      service: 'cl.bipbop.portales.bci', account: input.profile,
    });
  } catch (error: unknown) {
    if (error instanceof SecretServiceError) throw new PortalError(error.code, 'Credentials could not be read from Secret Service.');
    throw error;
  }
  const credentials = parseCredentials(encoded);
  const attempt = { submitted: false, accepted: false };
  try {
    await dependencies.portal.authenticate(
      credentials,
      () => { attempt.submitted = true; },
      () => { attempt.accepted = true; },
    );
  } catch (error: unknown) {
    if (attempt.submitted && !attempt.accepted) await dependencies.breaker.trip(input.profile);
    throw error;
  }
  if (!attempt.accepted) {
    if (attempt.submitted) await dependencies.breaker.trip(input.profile);
    throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'The login result was not accepted by the portal.');
  }
  return { profile: input.profile, authenticated: true as const };
}

export const authLoginMetadata = {
  service: 'bci-pyme', operation: 'auth.login', effect: 'read', auth: 'public',
} as const;
