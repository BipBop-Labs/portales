import { mkdir, open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PortalError } from '../errors.js';

const safeProfile = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u;

export function requireSafeProfile(profile: string): void {
  if (!safeProfile.test(profile)) {
    throw new PortalError('INVALID_INPUT', 'profile must be a safe local name of at most 64 characters.');
  }
}

export interface BreakerStatus {
  tripped: boolean;
  trippedAt: string | null;
  newLoginPermitted: boolean;
  /** Static resolution path; a breaker never resets itself. */
  resetRequires: 'human-review';
}

export class LoginBreaker {
  constructor(private readonly stateRoot: string) {}

  private path(profile: string): string {
    requireSafeProfile(profile);
    return join(this.stateRoot, 'portales', 'bci-pyme', 'login-breakers', profile);
  }

  async status(profile: string): Promise<BreakerStatus> {
    try {
      const info = await stat(this.path(profile));
      return { tripped: true, trippedAt: info.mtime.toISOString(), newLoginPermitted: false, resetRequires: 'human-review' };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { tripped: false, trippedAt: null, newLoginPermitted: true, resetRequires: 'human-review' };
      }
      throw error;
    }
  }

  async assertClear(profile: string): Promise<void> {
    if ((await this.status(profile)).tripped) {
      throw new PortalError('ACCOUNT_BLOCKED', 'Login is disabled for this profile pending human review.', {
        recovery: { stage: 'preflight', reason: 'login-breaker-tripped', nextCommand: `portales bci-pyme auth breaker status --profile ${profile}` },
      });
    }
  }

  async trip(profile: string): Promise<void> {
    const path = this.path(profile);
    await mkdir(join(this.stateRoot, 'portales', 'bci-pyme', 'login-breakers'), { recursive: true, mode: 0o700 });
    const file = await open(path, 'w', 0o600);
    try {
      await file.writeFile('{"blocked":true}\n', 'utf8');
      await file.chmod(0o600);
    } finally {
      await file.close();
    }
  }
}

/** Non-secret authentication bookkeeping: which static stage last established acceptance. */
export type AuthenticatedStage = 'device-registration-offer' | 'convention-selector' | 'authenticated-shell';

export interface AuthStateRecord {
  lastAuthenticatedStage: AuthenticatedStage;
  lastAuthenticatedAt: string;
}

export class AuthState {
  constructor(private readonly stateRoot: string) {}

  private path(profile: string): string {
    requireSafeProfile(profile);
    return join(this.stateRoot, 'portales', 'bci-pyme', 'auth-state', `${profile}.json`);
  }

  async read(profile: string): Promise<AuthStateRecord | null> {
    try {
      const parsed = JSON.parse(await readFile(this.path(profile), 'utf8')) as Partial<AuthStateRecord>;
      if (typeof parsed.lastAuthenticatedStage !== 'string' || typeof parsed.lastAuthenticatedAt !== 'string') return null;
      return { lastAuthenticatedStage: parsed.lastAuthenticatedStage, lastAuthenticatedAt: parsed.lastAuthenticatedAt };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      return null;
    }
  }

  async recordAuthenticated(profile: string, stage: AuthenticatedStage, now = new Date()): Promise<void> {
    await mkdir(join(this.stateRoot, 'portales', 'bci-pyme', 'auth-state'), { recursive: true, mode: 0o700 });
    const file = await open(this.path(profile), 'w', 0o600);
    try {
      const record: AuthStateRecord = { lastAuthenticatedStage: stage, lastAuthenticatedAt: now.toISOString() };
      await file.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
      await file.chmod(0o600);
    } finally {
      await file.close();
    }
  }
}
