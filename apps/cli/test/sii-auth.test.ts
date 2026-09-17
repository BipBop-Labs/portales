import { describe, expect, it, vi } from 'vitest';
import { SecretServiceError } from '../../../packages/runtime/src/secret-service.js';
import { PortalError } from '../../../services/bci-pyme/src/errors.js';
import { loginSiiWithPortalesProfile } from '../src/sii-auth.js';
import { LoginFailedError } from '../../../services/sii/src/errors/index.js';

const breaker = () => { let tripped = false; return { assertClear: () => tripped ? Promise.reject(new PortalError('ACCOUNT_BLOCKED', 'tripped')) : Promise.resolve(), trip: () => { tripped = true; return Promise.resolve(); }, get tripped() { return tripped; } }; };

describe('Portales SII authentication adapter', () => {
  it('reads the versioned profile bundle and gives only its clave to the SII login task', async () => {
    const read = vi.fn().mockResolvedValue(JSON.stringify({
      version: 1,
      rut: '20.000.042-0',
      clave: 'synthetic-clave',
    }));
    const keyringLogin = vi.fn(async (
      runtime: import('../../../services/sii/src/seams/index.js').Runtime,
      input: { rut: string },
    ) => {
      expect(await runtime.secrets?.get(input.rut)).toBe('synthetic-clave');
      return { authenticated: true as const, rut: input.rut, reason: 'keyring_login' as const };
    });

    const result = await loginSiiWithPortalesProfile(
      { profile: 'testing' },
      {
        secrets: { read },
        createRuntime: (_profile, overrides) => overrides as unknown as import('../../../services/sii/src/seams/index.js').Runtime,
        login: keyringLogin,
        breaker: breaker(),
      },
    );

    expect(read).toHaveBeenCalledWith({
      service: 'cl.bipbop.portales.sii',
      account: 'testing',
    });
    expect(keyringLogin).toHaveBeenCalledOnce();
    expect(result).toEqual({
      authenticated: true,
      rut: '20.000.042-0',
      reason: 'keyring_login',
    });
    expect(JSON.stringify(result)).not.toContain('synthetic-clave');
  });

  it('maps a missing profile bundle to the stable Portales credential error', async () => {
    const error = await loginSiiWithPortalesProfile(
      { profile: 'missing' },
      {
        secrets: {
          read: () => Promise.reject(new SecretServiceError('CREDENTIALS_NOT_CONFIGURED')),
        },
        breaker: breaker(),
      },
    ).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(PortalError);
    expect(error).toMatchObject({ code: 'CREDENTIALS_NOT_CONFIGURED' });
  });

  it('trips the breaker once SII rejects submitted credentials and refuses a second attempt', async () => {
    const b = breaker();
    const dependencies = {
      secrets: { read: () => Promise.resolve(JSON.stringify({ version: 1, rut: '20.000.042-0', clave: 'synthetic-clave' })) },
      createRuntime: (_profile: string, overrides: object) => overrides as import('../../../services/sii/src/seams/index.js').Runtime,
      login: vi.fn(() => Promise.reject(new LoginFailedError('Login no completado.'))),
      breaker: b,
    };
    const first = await loginSiiWithPortalesProfile({ profile: 'testing' }, dependencies).catch((e: unknown) => e);
    expect(first).toMatchObject({ code: 'LOGIN_FAILED', message: 'Login no completado.', recovery: { loginAttempted: true } });
    expect(b.tripped).toBe(true);
    const second = await loginSiiWithPortalesProfile({ profile: 'testing' }, dependencies).catch((e: unknown) => e);
    expect(second).toMatchObject({ code: 'ACCOUNT_BLOCKED' });
    expect(dependencies.login).toHaveBeenCalledOnce();
  });
});
