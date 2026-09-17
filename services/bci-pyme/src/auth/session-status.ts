import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { privateBciPaths } from '../portal/playwright-portal.js';
import { LoginBreaker, AuthState, type AuthenticatedStage, type BreakerStatus } from './login-breaker.js';

export interface SessionStatus {
  profile: string;
  /** LOCAL only: saved session material exists. Never a server-side liveness claim. */
  sessionPresent: boolean;
  savedAt: string | null;
  /** Earliest expiry among saved session cookies that carry one, or null when unknown. Values are never read. */
  earliestCookieExpiry: string | null;
  /** True when every expiring session cookie is already past its expiry by the local clock. */
  locallyExpired: boolean | null;
  lastAuthenticatedStage: AuthenticatedStage | null;
  lastAuthenticatedAt: string | null;
  breaker: BreakerStatus;
  newLoginPermitted: boolean;
  liveness: 'unknown-local-only';
}

interface SessionRoots { stateRoot: string; dataRoot: string }

/** Reads only metadata of the saved BCI session. Never opens a browser or reads cookie values into the result. */
export async function readSessionStatus(profile: string, roots: SessionRoots, now = new Date()): Promise<SessionStatus> {
  const paths = privateBciPaths(profile, roots.stateRoot, roots.dataRoot);
  const sessionPath = join(paths.profileDirectory, 'session-state.json');
  let sessionPresent = false;
  let savedAt: string | null = null;
  let earliestCookieExpiry: string | null = null;
  let locallyExpired: boolean | null = null;
  try {
    const info = await stat(sessionPath);
    sessionPresent = true;
    savedAt = info.mtime.toISOString();
    const parsed = JSON.parse(await readFile(sessionPath, 'utf8')) as { cookies?: { expires?: number }[] };
    const expiries = (parsed.cookies ?? []).map((cookie) => cookie.expires).filter((value): value is number => typeof value === 'number' && value > 0);
    if (expiries.length > 0) {
      const earliest = Math.min(...expiries) * 1000;
      earliestCookieExpiry = new Date(earliest).toISOString();
      locallyExpired = Math.max(...expiries) * 1000 < now.getTime();
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') sessionPresent = true;
  }
  const breaker = await new LoginBreaker(roots.stateRoot).status(profile);
  const authState = await new AuthState(roots.stateRoot).read(profile);
  return {
    profile, sessionPresent, savedAt, earliestCookieExpiry, locallyExpired,
    lastAuthenticatedStage: authState?.lastAuthenticatedStage ?? null,
    lastAuthenticatedAt: authState?.lastAuthenticatedAt ?? null,
    breaker, newLoginPermitted: breaker.newLoginPermitted, liveness: 'unknown-local-only',
  };
}

/** Removes local session material. BCI exposes no observed logout route in the recorded contract, so remote revocation is not attempted. */
export async function removeLocalSession(profile: string, roots: SessionRoots): Promise<{ profile: string; localSessionRemoved: boolean; remoteRevoked: false }> {
  const paths = privateBciPaths(profile, roots.stateRoot, roots.dataRoot);
  const sessionPath = join(paths.profileDirectory, 'session-state.json');
  let removed = false;
  try {
    await stat(sessionPath);
    removed = true;
  } catch {
    removed = false;
  }
  await rm(sessionPath, { force: true });
  await rm(join(paths.profileDirectory, 'Default'), { recursive: true, force: true });
  return { profile, localSessionRemoved: removed, remoteRevoked: false };
}
