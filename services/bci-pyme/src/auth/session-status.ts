import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { privateBciPaths } from '../portal/playwright-portal.js';
import { readSessionStatus as readSharedSessionStatus, removeSessionState, type SessionStatus as SharedSessionStatus } from '../../../../packages/runtime/src/session-status.js';
import { LoginBreaker, AuthState, type AuthenticatedStage } from './login-breaker.js';

export type SessionStatus = SharedSessionStatus<AuthenticatedStage>;

interface SessionRoots { stateRoot: string; dataRoot: string }

/** Reads only metadata of the saved BCI session. Never opens a browser or reads cookie values into the result. */
export function readSessionStatus(profile: string, roots: SessionRoots, now = new Date()): Promise<SessionStatus> {
  const paths = privateBciPaths(profile, roots.stateRoot, roots.dataRoot);
  return readSharedSessionStatus(profile, paths.profileDirectory, {
    breaker: new LoginBreaker(roots.stateRoot), authState: new AuthState(roots.stateRoot),
  }, now);
}

/** Removes local session material. BCI exposes no observed logout route in the recorded contract, so remote revocation is not attempted. */
export async function removeLocalSession(profile: string, roots: SessionRoots): Promise<{ profile: string; localSessionRemoved: boolean; remoteRevoked: false }> {
  const paths = privateBciPaths(profile, roots.stateRoot, roots.dataRoot);
  const removed = await removeSessionState(paths.profileDirectory);
  await rm(join(paths.profileDirectory, 'Default'), { recursive: true, force: true });
  return { profile, localSessionRemoved: removed, remoteRevoked: false };
}
