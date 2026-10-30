import { join } from 'node:path';
import { AuthState, LoginBreaker, requireSafeProfile } from '../../../../packages/runtime/src/login-breaker.js';
import type { SessionScope } from '../../../../packages/runtime/src/browser-session.js';

export const SERVICE = 'bancochile-personas';
/** Exact Secret Service attribute; a stable compatibility contract (see docs/service.md). */
export const KEYRING_SERVICE = 'cl.bipbop.portales.bancochile';
export const sessionScope: SessionScope = { label: 'bancochile', domain: 'bancochile.cl' };

/** Static stage that establishes acceptance: the authenticated personas portal. */
export type AuthenticatedStage = 'portal-personas';

export function privatePaths(profile: string, stateRoot: string, dataRoot: string) {
  requireSafeProfile(profile);
  const base = ['portales', SERVICE, profile];
  return {
    profileDirectory: join(stateRoot, ...base, 'browser'),
    downloadDirectory: join(dataRoot, ...base, 'downloads'),
  };
}

export const loginBreaker = (stateRoot: string) => new LoginBreaker(stateRoot, SERVICE);
export const authState = (stateRoot: string) => new AuthState<AuthenticatedStage>(stateRoot, SERVICE);
