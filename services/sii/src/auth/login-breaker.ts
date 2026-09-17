import { mkdir, open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PortalError } from '../../../../packages/runtime/src/errors.js';
import { isSafeName, stateRoot } from '../../../../packages/runtime/src/paths.js';

export interface SiiBreakerStatus {
  tripped: boolean;
  trippedAt: string | null;
  reason: string | null;
  newLoginPermitted: boolean;
  path: string;
}

/** Durable per-profile login breaker: once credentials were submitted and SII rejected or
 *  never accepted them, no further automatic attempt is allowed until a human clears it. */
export class SiiLoginBreaker {
  constructor(private readonly root: string = stateRoot()) {}

  private path(profile: string): string {
    if (!isSafeName(profile)) throw new PortalError('INVALID_INPUT', 'profile must be a safe local name of at most 64 characters.');
    return join(this.root, 'portales', 'sii', 'login-breakers', profile);
  }

  async status(profile: string): Promise<SiiBreakerStatus> {
    const path = this.path(profile);
    try {
      await stat(path);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { tripped: false, trippedAt: null, reason: null, newLoginPermitted: true, path };
      }
      throw error;
    }
    let record: { trippedAt?: string; reason?: string } = {};
    try { record = JSON.parse(await readFile(path, 'utf8')) as typeof record; } catch { record = {}; }
    return { tripped: true, trippedAt: record.trippedAt ?? null, reason: record.reason ?? null, newLoginPermitted: false, path };
  }

  async assertClear(profile: string): Promise<void> {
    const status = await this.status(profile);
    if (status.tripped) {
      throw new PortalError('ACCOUNT_BLOCKED', 'SII login is disabled for this profile pending human review.', {
        recovery: { reason: 'login-breaker-tripped', nextAction: `A human must review the failed login, then remove ${status.path} to permit a new attempt.`, nextCommand: `portales sii auth breaker status --profile ${profile} --json`, loginAttempted: false },
      });
    }
  }

  async trip(profile: string, reason: string): Promise<void> {
    const path = this.path(profile);
    await mkdir(join(this.root, 'portales', 'sii', 'login-breakers'), { recursive: true, mode: 0o700 });
    const file = await open(path, 'w', 0o600);
    try {
      await file.writeFile(`${JSON.stringify({ blocked: true, trippedAt: new Date().toISOString(), reason })}\n`, 'utf8');
      await file.chmod(0o600);
    } finally {
      await file.close();
    }
  }
}
