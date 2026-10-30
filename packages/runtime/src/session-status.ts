import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { sessionStateFile } from './browser-session.js';
import type { AuthState, BreakerStatus, LoginBreaker } from './login-breaker.js';

export interface SessionStatus<Stage extends string> {
  profile: string;
  /** LOCAL only: saved session material exists. Never a server-side liveness claim. */
  sessionPresent: boolean;
  savedAt: string | null;
  /** Earliest expiry among saved session cookies that carry one, or null when unknown. Values are never read. */
  earliestCookieExpiry: string | null;
  /** True when every expiring session cookie is already past its expiry by the local clock. */
  locallyExpired: boolean | null;
  lastAuthenticatedStage: Stage | null;
  lastAuthenticatedAt: string | null;
  breaker: BreakerStatus;
  newLoginPermitted: boolean;
  liveness: 'unknown-local-only';
}

/** Reads only metadata of a saved browser session. Never opens a browser or reads cookie values into the result. */
export async function readSessionStatus<Stage extends string>(
  profile: string,
  profileDirectory: string,
  state: { breaker: LoginBreaker; authState: AuthState<Stage> },
  now = new Date(),
): Promise<SessionStatus<Stage>> {
  const sessionPath = join(profileDirectory, sessionStateFile);
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
      earliestCookieExpiry = new Date(Math.min(...expiries) * 1000).toISOString();
      locallyExpired = Math.max(...expiries) * 1000 < now.getTime();
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') sessionPresent = true;
  }
  const breaker = await state.breaker.status(profile);
  const authState = await state.authState.read(profile);
  return {
    profile, sessionPresent, savedAt, earliestCookieExpiry, locallyExpired,
    lastAuthenticatedStage: authState?.lastAuthenticatedStage ?? null,
    lastAuthenticatedAt: authState?.lastAuthenticatedAt ?? null,
    breaker, newLoginPermitted: breaker.newLoginPermitted, liveness: 'unknown-local-only',
  };
}

/** Removes the saved session file; reports whether one existed. Remote revocation is the service's concern. */
export async function removeSessionState(profileDirectory: string): Promise<boolean> {
  const sessionPath = join(profileDirectory, sessionStateFile);
  const existed = await stat(sessionPath).then(() => true, () => false);
  await rm(sessionPath, { force: true });
  return existed;
}
