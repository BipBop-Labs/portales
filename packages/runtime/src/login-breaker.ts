import { mkdir, open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PortalError } from './errors.js';
import { isSafeName } from './paths.js';

export function requireSafeProfile(profile: string): void {
  if (!isSafeName(profile)) {
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

/** Durable per-service, per-profile login breaker. Once a submitted login was rejected or
 *  never accepted, no new attempt is permitted until a human removes the marker. */
export class LoginBreaker {
  constructor(private readonly stateRoot: string, private readonly service: string) {}

  private directory(): string {
    return join(this.stateRoot, 'portales', this.service, 'login-breakers');
  }

  private path(profile: string): string {
    requireSafeProfile(profile);
    return join(this.directory(), profile);
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
        recovery: { stage: 'preflight', reason: 'login-breaker-tripped', nextCommand: `portales ${this.service} auth breaker status --profile ${profile}` },
      });
    }
  }

  async trip(profile: string): Promise<void> {
    const path = this.path(profile);
    await mkdir(this.directory(), { recursive: true, mode: 0o700 });
    const file = await open(path, 'w', 0o600);
    try {
      await file.writeFile('{"blocked":true}\n', 'utf8');
      await file.chmod(0o600);
    } finally {
      await file.close();
    }
  }
}

export interface AuthStateRecord<Stage extends string> {
  lastAuthenticatedStage: Stage;
  lastAuthenticatedAt: string;
}

/** Non-secret authentication bookkeeping: which static stage last established acceptance. */
export class AuthState<Stage extends string> {
  constructor(private readonly stateRoot: string, private readonly service: string) {}

  private directory(): string {
    return join(this.stateRoot, 'portales', this.service, 'auth-state');
  }

  private path(profile: string): string {
    requireSafeProfile(profile);
    return join(this.directory(), `${profile}.json`);
  }

  async read(profile: string): Promise<AuthStateRecord<Stage> | null> {
    try {
      const parsed = JSON.parse(await readFile(this.path(profile), 'utf8')) as Partial<AuthStateRecord<Stage>>;
      if (typeof parsed.lastAuthenticatedStage !== 'string' || typeof parsed.lastAuthenticatedAt !== 'string') return null;
      return { lastAuthenticatedStage: parsed.lastAuthenticatedStage, lastAuthenticatedAt: parsed.lastAuthenticatedAt };
    } catch {
      return null;
    }
  }

  async recordAuthenticated(profile: string, stage: Stage, now = new Date()): Promise<void> {
    await mkdir(this.directory(), { recursive: true, mode: 0o700 });
    const file = await open(this.path(profile), 'w', 0o600);
    try {
      const record: AuthStateRecord<Stage> = { lastAuthenticatedStage: stage, lastAuthenticatedAt: now.toISOString() };
      await file.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
      await file.chmod(0o600);
    } finally {
      await file.close();
    }
  }
}
