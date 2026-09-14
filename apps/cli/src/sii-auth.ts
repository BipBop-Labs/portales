import { SecretServiceError, type SecretReader } from '../../../packages/runtime/src/secret-service.js';
import { PortalError } from '../../../services/bci-pyme/src/errors.js';
import { keyringLogin } from '../../../services/sii/src/tasks/auth.js';
import { createPortalesSiiRuntime } from '../../../services/sii/src/runtime.js';
import type { Runtime, SecretReader as SiiSecretReader } from '../../../services/sii/src/seams/index.js';

const SII_KEYRING_SERVICE = 'cl.bipbop.portales.sii';

interface SiiAuthDependencies {
  secrets: SecretReader;
  createRuntime?: (profile: string, overrides: Partial<Runtime>) => Runtime;
  login?: typeof keyringLogin;
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

export async function loginSiiWithPortalesProfile(
  input: { profile: string },
  dependencies: SiiAuthDependencies,
): Promise<unknown> {
  let encodedBundle: string;
  try {
    encodedBundle = await dependencies.secrets.read({
      service: SII_KEYRING_SERVICE,
      account: input.profile,
    });
  } catch (error: unknown) {
    if (error instanceof SecretServiceError) {
      throw new PortalError(error.code, 'The SII credentials are not configured for this profile.');
    }
    throw error;
  }
  const bundle = parseCredentialBundle(encodedBundle);
  const normalizedBundleRut = normalizeRut(bundle.rut);
  const secrets: SiiSecretReader = {
    get: (account) => Promise.resolve(normalizeRut(account) === normalizedBundleRut ? bundle.clave : null),
  };
  const runtime = (dependencies.createRuntime ?? createPortalesSiiRuntime)(input.profile, { secrets });
  return (dependencies.login ?? keyringLogin)(runtime, { rut: bundle.rut });
}
