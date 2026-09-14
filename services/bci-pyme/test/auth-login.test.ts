import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PortalError } from '../src/errors.js';
import { LoginBreaker } from '../src/auth/login-breaker.js';
import { loginBciPyme, type BciCredentials } from '../src/tasks/auth-login.js';

describe('auth.login risk controls', () => {
  it('reads the exact keyring item and performs one explicit attempt', async () => {
    const read = vi.fn().mockResolvedValue(JSON.stringify({
      version: 1, rut: '999999999', password: 'synthetic-password',
    }));
    const authenticate = vi.fn().mockImplementation((
      _credentials: BciCredentials,
      submitted: () => void,
      accepted: () => void,
    ) => {
      submitted();
      accepted();
      return Promise.resolve();
    });
    const breaker = { assertClear: vi.fn(), trip: vi.fn() };

    await expect(loginBciPyme(
      { profile: 'synthetic-profile' },
      { secrets: { read }, breaker, portal: { authenticate } },
    )).resolves.toEqual({ profile: 'synthetic-profile', authenticated: true });

    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith({
      service: 'cl.bipbop.portales.bci', account: 'synthetic-profile',
    });
    expect(authenticate).toHaveBeenCalledOnce();
    expect(authenticate).toHaveBeenCalledWith(
      expect.any(Object), expect.any(Function), expect.any(Function),
    );
    expect(breaker.trip).not.toHaveBeenCalled();
  });

  it('trips a generic private breaker after an ambiguous submitted attempt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portales-breaker-synthetic-'));
    const breaker = new LoginBreaker(root);
    const portal = { authenticate: vi.fn().mockImplementation((_credentials: BciCredentials, submitted: () => void) => {
      submitted();
      return Promise.reject(new PortalError('REMOTE_STATE_AMBIGUOUS', 'provider detail must not persist'));
    }) };

    await expect(loginBciPyme(
      { profile: 'synthetic-profile' },
      { secrets: { read: vi.fn().mockResolvedValue('{"version":1,"rut":"999999999","password":"synthetic-password"}') }, breaker, portal },
    )).rejects.toMatchObject({ code: 'REMOTE_STATE_AMBIGUOUS' });

    const path = join(root, 'portales', 'bci-pyme', 'login-breakers', 'synthetic-profile');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const contents = await readFile(path, 'utf8');
    expect(contents).toBe('{"blocked":true}\n');
    expect(contents).not.toContain('provider');
  });

  it('does not trip the login breaker after BCI accepted authentication', async () => {
    const breaker = { assertClear: vi.fn(), trip: vi.fn() };
    const authenticate = vi.fn().mockImplementation((
      _credentials: BciCredentials,
      submitted: () => void,
      accepted: () => void,
    ) => {
      submitted();
      accepted();
      return Promise.reject(new PortalError('REMOTE_STATE_AMBIGUOUS', 'post-login navigation failed'));
    });

    await expect(loginBciPyme(
      { profile: 'synthetic-profile' },
      {
        secrets: { read: vi.fn().mockResolvedValue('{"version":1,"rut":"999999999","password":"synthetic-password"}') },
        breaker,
        portal: { authenticate },
      },
    )).rejects.toMatchObject({ code: 'REMOTE_STATE_AMBIGUOUS' });
    expect(breaker.trip).not.toHaveBeenCalled();
  });

  it('trips the breaker when the portal returns without proving acceptance', async () => {
    const breaker = { assertClear: vi.fn(), trip: vi.fn() };
    const authenticate = vi.fn().mockImplementation((_credentials: BciCredentials, submitted: () => void) => {
      submitted();
      return Promise.resolve();
    });

    await expect(loginBciPyme(
      { profile: 'synthetic-profile' },
      {
        secrets: { read: vi.fn().mockResolvedValue('{"version":1,"rut":"999999999","password":"synthetic-password"}') },
        breaker,
        portal: { authenticate },
      },
    )).rejects.toMatchObject({ code: 'REMOTE_STATE_AMBIGUOUS' });
    expect(breaker.trip).toHaveBeenCalledOnce();
  });

  it('a breaker prevents keyring and browser access', async () => {
    const read = vi.fn();
    const authenticate = vi.fn();
    await expect(loginBciPyme(
      { profile: 'synthetic-profile' },
      { secrets: { read }, breaker: { assertClear: vi.fn(() => { throw new PortalError('ACCOUNT_BLOCKED', 'blocked'); }), trip: vi.fn() }, portal: { authenticate } },
    )).rejects.toMatchObject({ code: 'ACCOUNT_BLOCKED' });
    expect(read).not.toHaveBeenCalled();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('rejects anything except the exact version-1 credential object', async () => {
    for (const value of [
      '{"version":2,"rut":"synthetic","password":"synthetic"}',
      '{"version":1,"rut":"synthetic","password":"synthetic","extra":true}',
      '{"version":1,"rut":"","password":"synthetic"}',
    ]) {
      const authenticate = vi.fn();
      await expect(loginBciPyme(
        { profile: 'synthetic-profile' },
        { secrets: { read: vi.fn().mockResolvedValue(value) }, breaker: { assertClear: vi.fn(), trip: vi.fn() }, portal: { authenticate } },
      )).rejects.toMatchObject({ code: 'CREDENTIALS_INVALID' });
      expect(authenticate).not.toHaveBeenCalled();
    }
  });
});
