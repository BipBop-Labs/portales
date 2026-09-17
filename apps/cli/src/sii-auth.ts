import { SecretServiceError, type SecretReader } from '../../../packages/runtime/src/secret-service.js';
import { PortalError } from '../../../packages/runtime/src/errors.js';
import { keyringLogin } from '../../../services/sii/src/tasks/auth.js';
import { createPortalesSiiRuntime } from '../../../services/sii/src/runtime.js';
import { SiiLoginBreaker } from '../../../services/sii/src/auth/login-breaker.js';
import { SII_KEYRING_SERVICE } from '../../../services/sii/src/tasks/auth-setup.js';
import { CredentialNotFoundError, LoginFailedError } from '../../../services/sii/src/errors/index.js';
import { SII_DOCS, toPortalError } from '../../../services/sii/src/portales-errors.js';
import type { Runtime, SecretReader as SiiSecretReader } from '../../../services/sii/src/seams/index.js';

interface Breaker {
  assertClear(profile: string): Promise<void>;
  trip(profile: string, reason: string): Promise<void>;
}

interface SiiAuthDependencies {
  secrets: SecretReader;
  createRuntime?: (profile: string, overrides: Partial<Runtime>) => Runtime;
  login?: typeof keyringLogin;
  breaker?: Breaker;
}

interface SiiCredentialBundle {
  version: 1;
  rut: string;
  clave: string;
}

function parseCredentialBundle(value: string): SiiCredentialBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new PortalError('CREDENTIALS_INVALID', 'The SII credential bundle is invalid.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new PortalError('CREDENTIALS_INVALID', 'The SII credential bundle is invalid.');
  }
  const bundle = parsed as Record<string, unknown>;
  if (bundle.version !== 1 || typeof bundle.rut !== 'string' || bundle.rut === ''
    || typeof bundle.clave !== 'string' || bundle.clave === '') {
    throw new PortalError('CREDENTIALS_INVALID', 'The SII credential bundle is invalid.');
  }
  return { version: 1, rut: bundle.rut, clave: bundle.clave };
}

function normalizeRut(value: string): string {
  return value.replace(/[.\s]/gu, '').toUpperCase();
}

/** One explicit SII login from the profile bundle. Trips the breaker when SII rejected submitted credentials. */
export async function loginSiiWithPortalesProfile(
  input: { profile: string },
  dependencies: SiiAuthDependencies,
): Promise<unknown> {
  const breaker = dependencies.breaker ?? new SiiLoginBreaker();
  await breaker.assertClear(input.profile);
  let encodedBundle: string;
  try {
    encodedBundle = await dependencies.secrets.read({ service: SII_KEYRING_SERVICE, account: input.profile });
  } catch (error: unknown) {
    if (error instanceof SecretServiceError) {
      throw new PortalError(error.code, 'The SII credentials are not configured for this profile.', {
        recovery: { nextCommand: `portales sii auth setup --profile ${input.profile}` },
      });
    }
    throw error;
  }
  const bundle = parseCredentialBundle(encodedBundle);
  const normalizedBundleRut = normalizeRut(bundle.rut);
  const secrets: SiiSecretReader = {
    get: (account) => Promise.resolve(normalizeRut(account) === normalizedBundleRut ? bundle.clave : null),
  };
  const runtime = (dependencies.createRuntime ?? createPortalesSiiRuntime)(input.profile, { secrets });
  try {
    return await (dependencies.login ?? keyringLogin)(runtime, { rut: bundle.rut });
  } catch (error: unknown) {
    // A LoginFailedError after the bundle resolved means credentials reached SII; never retry automatically.
    if (error instanceof LoginFailedError && !(error instanceof CredentialNotFoundError)) {
      await breaker.trip(input.profile, 'login-failed');
    }
    throw toPortalError(error, { profile: input.profile, contractRef: `${SII_DOCS}#authentication` });
  }
}
