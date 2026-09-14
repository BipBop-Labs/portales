import { mkdir, open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PortalError } from '../errors.js';

const safeProfile = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u;

export function requireSafeProfile(profile: string): void {
  if (!safeProfile.test(profile)) {
    throw new PortalError('INVALID_INPUT', 'profile must be a safe local name of at most 64 characters.');
  }
}

export class LoginBreaker {
  constructor(private readonly stateRoot: string) {}

  private path(profile: string): string {
    requireSafeProfile(profile);
    return join(this.stateRoot, 'portales', 'bci-pyme', 'login-breakers', profile);
  }

  async assertClear(profile: string): Promise<void> {
    try {
      await stat(this.path(profile));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    throw new PortalError('ACCOUNT_BLOCKED', 'Login is disabled for this profile pending human review.');
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
