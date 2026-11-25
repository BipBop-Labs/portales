import { PortalError } from '../../../../packages/runtime/src/errors.js';
import { loginOnce, type OneShotLoginPortal } from '../../../../packages/runtime/src/one-shot-login.js';
import { requireSafeProfile } from '../../../../packages/runtime/src/login-breaker.js';
import { isValidRut } from '../../../../packages/runtime/src/rut.js';
import { readHidden, requireInteractiveTerminal, storeSecret } from '../../../../packages/runtime/src/secret-setup.js';
import type { SecretReader } from '../../../../packages/runtime/src/secret-service.js';
import { readSessionStatus, removeSessionState } from '../../../../packages/runtime/src/session-status.js';
import { authState, KEYRING_SERVICE, loginBreaker, privatePaths } from '../auth/state.js';

export interface Credentials { rut: string; password: string }

/** Version 1 bundle: exactly {version: 1, rut, password}. */
export function parseCredentials(value: string): Credentials {
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

/** Interactive enrollment only: hidden prompts, local validation, explicit confirmation, then one
 *  write of the exact (cl.bipbop.portales.bancochile, <profile>) item. Never authenticates. */
export async function setup(input: { profile: string }): Promise<{ configured: true; profile: string }> {
  requireSafeProfile(input.profile);
  requireInteractiveTerminal();
  let rut = '';
  let password = '';
  let encoded = '';
  try {
    rut = await readHidden('RUT Banco de Chile (entrada oculta): ');
    password = await readHidden('Clave Banco de Chile (entrada oculta): ');
    encoded = JSON.stringify({ version: 1, rut, password });
    parseCredentials(encoded);
    const confirmation = await readHidden(`Guardar o reemplazar credenciales Banco de Chile del perfil ${input.profile}: escribe guardar: `);
    if (confirmation !== 'guardar') throw new PortalError('INVALID_INPUT', 'Credential setup was cancelled.');
    await storeSecret({ service: KEYRING_SERVICE, account: input.profile, label: 'Portales Banco de Chile', encoded });
    return { configured: true, profile: input.profile };
  } finally {
    rut = '';
    password = '';
    encoded = '';
  }
}

interface Roots { stateRoot: string; dataRoot: string }

/** Makes one explicit login attempt with the keyring bundle; never retried. */
export function login(input: { profile: string }, dependencies: { secrets: SecretReader; portal: OneShotLoginPortal<Credentials>; stateRoot: string }) {
  return loginOnce({
    profile: input.profile, keyringService: KEYRING_SERVICE, stage: 'portal-personas' as const,
    parse: parseCredentials, secrets: dependencies.secrets, portal: dependencies.portal,
    breaker: loginBreaker(dependencies.stateRoot), authState: authState(dependencies.stateRoot),
  });
}

/** Local-only status: no browser, no portal contact, no credential submission. */
export function status(input: { profile: string }, roots: Roots) {
  const paths = privatePaths(input.profile, roots.stateRoot, roots.dataRoot);
  return readSessionStatus(input.profile, paths.profileDirectory, { breaker: loginBreaker(roots.stateRoot), authState: authState(roots.stateRoot) });
}

/** Removes local session material. No remote logout route has been observed, so remoteRevoked is always false. */
export async function logout(input: { profile: string }, roots: Roots) {
  requireSafeProfile(input.profile);
  const paths = privatePaths(input.profile, roots.stateRoot, roots.dataRoot);
  return { profile: input.profile, localSessionRemoved: await removeSessionState(paths.profileDirectory), remoteRevoked: false as const };
}

export function breakerStatus(input: { profile: string }, roots: Roots) {
  return loginBreaker(roots.stateRoot).status(input.profile);
}
