import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SecretServiceError, type SecretReader } from '../../../packages/runtime/src/secret-service.js';
import { PortalError } from '../../../services/bci-pyme/src/errors.js';

const SII_KEYRING_SERVICE = 'cl.bipbop.portales.sii';

interface SiiSecretStore {
  get(account: string): Promise<string | null>;
}

interface SiiRuntime {
  secrets: SiiSecretStore;
  [key: string]: unknown;
}

interface SiiCore {
  createNodeRuntime(overrides: { secrets: SiiSecretStore }): SiiRuntime;
  keyringLogin(runtime: SiiRuntime, input: { rut: string }): Promise<unknown>;
}

interface SiiAuthDependencies {
  secrets: SecretReader;
  loadCore?: () => Promise<SiiCore>;
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

function siiDistRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../../../services/sii/packages/core/dist'),
    resolve(here, '../../../services/sii/packages/core/dist'),
  ];
  const root = candidates.find((candidate) => existsSync(resolve(candidate, 'node.js')));
  if (!root) throw new PortalError('PORTAL_CHANGED', 'The SII dependency is not built. Run `npm run build`.');
  return root;
}

async function loadInstalledCore(): Promise<SiiCore> {
  const root = siiDistRoot();
  const nodeModule = await import(pathToFileURL(resolve(root, 'node.js')).href) as unknown as Record<string, unknown>;
  const cliModule = await import(pathToFileURL(resolve(root, 'cli.js')).href) as unknown as Record<string, unknown>;
  if (typeof nodeModule.createNodeRuntime !== 'function' || typeof cliModule.keyringLogin !== 'function') {
    throw new PortalError('PORTAL_CHANGED', 'The SII dependency does not expose its expected login interface.');
  }
  return {
    createNodeRuntime: nodeModule.createNodeRuntime as SiiCore['createNodeRuntime'],
    keyringLogin: cliModule.keyringLogin as SiiCore['keyringLogin'],
  };
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
  const secretStore: SiiSecretStore = {
    get: (account) => Promise.resolve(normalizeRut(account) === normalizedBundleRut ? bundle.clave : null),
  };
  const core = await (dependencies.loadCore ?? loadInstalledCore)();
  return core.keyringLogin(core.createNodeRuntime({ secrets: secretStore }), { rut: bundle.rut });
}
