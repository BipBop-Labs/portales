import { requireSafeProfile } from '../auth/login-breaker.js';
import { readSessionStatus, removeLocalSession } from '../auth/session-status.js';

interface Roots { stateRoot: string; dataRoot: string }

/** Local-only status: no browser, no portal contact, no credential submission. */
export function authStatus(input: { profile: string }, roots: Roots) {
  requireSafeProfile(input.profile);
  return readSessionStatus(input.profile, roots);
}

export function authLogout(input: { profile: string }, roots: Roots) {
  requireSafeProfile(input.profile);
  return removeLocalSession(input.profile, roots);
}

export const authStatusMetadata = { service: 'bci-pyme', operation: 'auth.status', effect: 'read', auth: 'public' } as const;
export const authLogoutMetadata = { service: 'bci-pyme', operation: 'auth.logout', effect: 'write', auth: 'public' } as const;
