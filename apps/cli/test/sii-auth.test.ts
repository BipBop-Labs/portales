import { describe, expect, it, vi } from 'vitest';
import { SecretServiceError } from '../../../packages/runtime/src/secret-service.js';
import { PortalError } from '../../../services/bci-pyme/src/errors.js';
import { loginSiiWithPortalesProfile } from '../src/sii-auth.js';

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
      },
    ).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(PortalError);
    expect(error).toMatchObject({ code: 'CREDENTIALS_NOT_CONFIGURED' });
  });
});
