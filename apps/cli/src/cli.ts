import { writeDestinatario } from '../../../services/bci-pyme/src/tasks/destinatarios-write.js';
import { readPrivateJson } from './private-input.js';
import { PortalError } from '../../../services/bci-pyme/src/errors.js';
import type { BciPymePortal, CartolaSelection } from '../../../services/bci-pyme/src/portal/types.js';
import { listBusinesses } from '../../../services/bci-pyme/src/tasks/businesses-list.js';
import { downloadCartolas } from '../../../services/bci-pyme/src/tasks/cartolas-download.js';
import { listAccountOptions, listCartolaOptions } from '../../../services/bci-pyme/src/tasks/options.js';
import { listDestinatarios } from '../../../services/bci-pyme/src/tasks/destinatarios-list.js';
import { listDestinatarioOptions } from '../../../services/bci-pyme/src/tasks/destinatarios-options.js';
import { runSag } from './sag.js';

interface CliDependencies {
  openSessionPortal(profile: string): Promise<BciPymePortal & { close?: () => Promise<void> }>;
  setup?: (input: { profile: string }) => Promise<unknown>;
  login(input: { profile: string }): Promise<unknown>;
  loginSii?: (input: { profile: string }) => Promise<unknown>;
  runSii?: (args: string[]) => Promise<number>;
  stdout(value: string): void;
  stderr(value: string): void;
}

function option(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (value === undefined || value.startsWith('--')) {
    throw new PortalError('INVALID_INPUT', `${name} is required.`);
  }
  return value;
}

function isSelection(value: unknown): value is CartolaSelection {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.businessId === 'string'
    && typeof item.accountId === 'string'
    && item.documentType === 'excel-detallado';
}

async function readPrivateSelections(path: string): Promise<CartolaSelection[]> {
  const parsed = await readPrivateJson(path);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new PortalError('INVALID_INPUT', 'The input file must contain a JSON object.');
  }
  const selections = (parsed as Record<string, unknown>).selections;
  if (!Array.isArray(selections) || !selections.every(isSelection)) {
    throw new PortalError('INVALID_INPUT', 'The input file must contain valid cartola selections.');
  }
  return selections;
}

function loginInput(args: string[], profile: string): { profile: string } {
  const expected = ['bci-pyme', 'auth', 'login', '--profile', profile];
  if (args.length !== expected.length || expected.some((value, index) => args[index] !== value)) {
    throw new PortalError('INVALID_INPUT', 'auth login accepts only --profile.');
  }
  return { profile };
}

export async function runCli(args: string[], dependencies: CliDependencies): Promise<number> {
  let portal: (BciPymePortal & { close?: () => Promise<void> }) | undefined;
  try {
    if (args[0] === 'sag') return await runSag(args.slice(1), value => { dependencies.stdout(value); });
    if (args[0] === 'sii') {
      if (args[1] === 'auth' && args[2] === 'login') {
        const profile = option(args, '--profile');
        const expected = ['sii', 'auth', 'login', '--profile', profile];
        if (args.length !== expected.length || expected.some((value, index) => args[index] !== value)) {
          throw new PortalError('INVALID_INPUT', 'SII auth login accepts only --profile.');
        }
        if (!dependencies.loginSii) throw new PortalError('PORTAL_CHANGED', 'The SII login dependency is unavailable.');
        const result = await dependencies.loginSii({ profile });
        dependencies.stdout(`${JSON.stringify(result)}\n`);
        return 0;
      }
      if (!dependencies.runSii) throw new PortalError('PORTAL_CHANGED', 'The SII dependency is unavailable.');
      return await dependencies.runSii(args.slice(1));
    }
    if (args[0] !== 'bci-pyme') throw new PortalError('INVALID_INPUT', 'Unknown service.');
    const profile = option(args, '--profile');
    let result: unknown;
    if (args[1] === 'auth' && args[2] === 'setup') {
      const expected = ['bci-pyme', 'auth', 'setup', '--profile', profile];
      if (args.length !== expected.length || expected.some((value, index) => args[index] !== value)) {
        throw new PortalError('INVALID_INPUT', 'auth setup accepts only --profile; enter credentials at the hidden terminal prompts.');
      }
      if (!dependencies.setup) throw new PortalError('KEYRING_UNAVAILABLE', 'Interactive credential setup is unavailable.');
      result = await dependencies.setup({ profile });
    } else if (args[1] === 'auth' && args[2] === 'login') {
      result = await dependencies.login(loginInput(args, profile));
    } else if (args[1] === 'businesses' && args[2] === 'list') {
      portal = await dependencies.openSessionPortal(profile);
      result = await listBusinesses({ profile }, portal);
    } else if (args[1] === 'destinatarios' && ['prepare', 'create', 'authorize', 'delete'].includes(args[2] ?? '')) {
      const preview = args[2] === 'prepare';
      const action = preview ? option(args, '--action') : args[2];
      if (action !== 'create' && action !== 'authorize' && action !== 'delete') throw new PortalError('INVALID_INPUT', 'The action must be create, authorize or delete.');
      const value = await readPrivateJson(option(args, '--input'));
      const confirmation = preview ? undefined : option(args, '--confirm');
      portal = await dependencies.openSessionPortal(profile);
      result = await writeDestinatario({ profile, action, value, preview, ...(confirmation === undefined ? {} : { confirmation }) }, portal,
        stage => { dependencies.stderr(`${JSON.stringify({ service: 'bci-pyme', operation: `destinatarios.${action}`, stage })}\n`); });
    } else if (args[1] === 'destinatarios' && args[2] === 'list') {
      const businessId = option(args, '--business-id');
      portal = await dependencies.openSessionPortal(profile);
      result = await listDestinatarios({ profile, businessId }, portal);
    } else if (args[1] === 'destinatarios' && args[2] === 'options') {
      const businessId = option(args, '--business-id');
      portal = await dependencies.openSessionPortal(profile);
      result = await listDestinatarioOptions({ profile, businessId }, portal);
    } else if (args[1] === 'accounts' && args[2] === 'options') {
      const businessId = option(args, '--business-id');
      portal = await dependencies.openSessionPortal(profile);
      result = await listAccountOptions(
        { profile, businessId },
        portal,
      );
    } else if (args[1] === 'cartolas' && args[2] === 'options') {
      result = listCartolaOptions();
    } else if (args[1] === 'cartolas' && args[2] === 'download') {
      const selections = await readPrivateSelections(option(args, '--input'));
      portal = await dependencies.openSessionPortal(profile);
      result = await downloadCartolas(
        { profile, selections },
        portal,
      );
    } else {
      throw new PortalError('INVALID_INPUT', 'Unknown command.');
    }
    dependencies.stdout(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error: unknown) {
    const failure = error instanceof PortalError
      ? error
      : new PortalError('PORTAL_CHANGED', 'The operation could not be completed safely.');
    dependencies.stderr(`${JSON.stringify({ error: {
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable,
    } })}\n`);
    return failure.code === 'CONFIRMATION_REQUIRED' ? 8 : failure.code === 'INVALID_INPUT' ? 2
      : failure.code === 'NOT_AUTHENTICATED' || failure.code === 'SESSION_EXPIRED' ? 3
        : failure.code === 'LOGIN_FAILED' || failure.code === 'ADDITIONAL_AUTH_REQUIRED'
          || failure.code === 'CREDENTIALS_INVALID' || failure.code === 'CREDENTIALS_NOT_CONFIGURED'
          || failure.code === 'KEYRING_LOCKED' || failure.code === 'KEYRING_UNAVAILABLE' ? 4
        : failure.code === 'AUTHORIZATION_DENIED' ? 5
          : failure.code === 'ACCOUNT_BLOCKED' || failure.code === 'RATE_LIMITED' ? 6 : 7;
  } finally {
    await portal?.close?.();
  }
}
