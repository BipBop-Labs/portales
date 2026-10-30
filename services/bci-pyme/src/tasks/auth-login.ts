import { isValidRut } from '../rut.js';
import type { SecretReader } from '../../../../packages/runtime/src/secret-service.js';
import { loginOnce } from '../../../../packages/runtime/src/one-shot-login.js';
import { PortalError } from '../errors.js';

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
interface AuthStateWriter { recordAuthenticated(profile: string, stage: 'authenticated-shell'): Promise<void> | void }
interface LoginDependencies { secrets: SecretReader; breaker: Breaker; portal: LoginPortal; authState?: AuthStateWriter }

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
export function loginBciPyme(
  input: { profile: string },
  dependencies: LoginDependencies,
) {
  return loginOnce({
    profile: input.profile, keyringService: 'cl.bipbop.portales.bci', stage: 'authenticated-shell' as const,
    parse: parseCredentials, secrets: dependencies.secrets, breaker: dependencies.breaker,
    portal: dependencies.portal, ...(dependencies.authState === undefined ? {} : { authState: dependencies.authState }),
  });
}

export const authLoginMetadata = {
  service: 'bci-pyme', operation: 'auth.login', effect: 'read', auth: 'public',
} as const;
