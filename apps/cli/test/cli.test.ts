import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { PortalError } from '../../../services/bci-pyme/src/errors.js';

describe('public CLI', () => {
  it('logs in to SII through the Portales profile contract instead of the delegated CLI', async () => {
    const writes: string[] = [];
    const loginSii = vi.fn().mockResolvedValue({ authenticated: true, reason: 'keyring_login' });
    const runSii = vi.fn();

    expect(await runCli(
      ['sii', 'auth', 'login', '--profile', 'testing'],
      {
        loginSii,
        runSii,
        login: vi.fn(),
        openSessionPortal: vi.fn(),
        stdout: (value) => writes.push(value),
        stderr: vi.fn(),
      },
    )).toBe(0);

    expect(loginSii).toHaveBeenCalledWith({ profile: 'testing' });
    expect(runSii).not.toHaveBeenCalled();
    expect(writes).toEqual(['{"authenticated":true,"reason":"keyring_login"}\n']);
  });

  it('dispatches explicit auth login without constructing a session portal', async () => {
    const writes: string[] = [];
    const login = vi.fn().mockResolvedValue({ profile: 'testing', authenticated: true });
    const openSessionPortal = vi.fn();
    expect(await runCli(
      ['bci-pyme', 'auth', 'login', '--profile', 'testing'],
      { login, openSessionPortal, stdout: (value) => writes.push(value), stderr: vi.fn() },
    )).toBe(0);
    expect(login).toHaveBeenCalledWith({ profile: 'testing' });
    expect(openSessionPortal).not.toHaveBeenCalled();
    expect(writes).toEqual(['{"profile":"testing","authenticated":true}\n']);
  });

  it('opts into phone-approval continuation without accepting authentication secrets', async () => {
    const login = vi.fn().mockResolvedValue({ profile: 'testing', authenticated: true });
    const dependencies = {
      login, openSessionPortal: vi.fn(), stdout: vi.fn(), stderr: vi.fn(),
    };

    expect(await runCli([
      'bci-pyme', 'auth', 'login', '--profile', 'testing', '--wait-for-phone-approval',
    ], dependencies)).toBe(0);
    expect(login).toHaveBeenCalledWith({ profile: 'testing', waitForPhoneApproval: true });

    expect(await runCli([
      'bci-pyme', 'auth', 'login', '--profile', 'testing', '--wait-for-phone-approval',
      '--otp', 'synthetic-secret',
    ], dependencies)).toBe(2);
    expect(login).toHaveBeenCalledOnce();
  });

  it('emits businesses list JSON exactly once', async () => {
    const writes: string[] = [];
    const login = vi.fn();
    const portal = {
      requireAuthenticatedSession: vi.fn().mockResolvedValue(undefined),
      discoverBusinesses: vi.fn().mockResolvedValue([]),
      discoverAccounts: vi.fn(),
      downloadCartola: vi.fn(),
    };
    const exitCode = await runCli(
      ['bci-pyme', 'businesses', 'list', '--profile', 'testing'],
      { openSessionPortal: vi.fn().mockResolvedValue(portal), login, stdout: (value) => writes.push(value), stderr: vi.fn() },
    );
    expect(exitCode).toBe(0);
    expect(writes).toEqual(['{"businesses":[]}\n']);
    expect(portal.requireAuthenticatedSession).toHaveBeenCalledOnce();
    expect(login).not.toHaveBeenCalled();
  });

  it('reads private cartola intent from an input file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'portales-cli-synthetic-'));
    const inputPath = join(directory, 'input.json');
    await writeFile(inputPath, JSON.stringify({ selections: [{
      businessId: 'business-synthetic-a', accountId: 'account-synthetic-a',
      documentType: 'excel-detallado',
    }] }), { mode: 0o600 });
    const portal = {
      requireAuthenticatedSession: vi.fn().mockResolvedValue(undefined),
      discoverBusinesses: vi.fn().mockResolvedValue([{ id: 'business-synthetic-a', label: 'Empresa' }]),
      discoverAccounts: vi.fn().mockResolvedValue([{ id: 'account-synthetic-a', label: 'Cuenta' }]),
      downloadCartola: vi.fn().mockResolvedValue({ path: '/private/synthetic/file.xlsx', mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteCount: 20, sha256: 'b'.repeat(64) }),
    };
    const login = vi.fn();
    expect(await runCli(
      ['bci-pyme', 'cartolas', 'download', '--profile', 'testing', '--input', inputPath],
      { openSessionPortal: vi.fn().mockResolvedValue(portal), login, stdout: vi.fn(), stderr: vi.fn() },
    )).toBe(0);
    expect(portal.downloadCartola).toHaveBeenCalledOnce();
    expect(login).not.toHaveBeenCalled();
  });

  it('emits portal-open failures as stable JSON on stderr', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const openSessionPortal = vi.fn().mockRejectedValue(new Error('browser implementation detail'));
    expect(await runCli(
      ['bci-pyme', 'businesses', 'list', '--profile', 'testing'],
      { openSessionPortal, login: vi.fn(), stdout, stderr },
    )).toBe(7);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith('{"error":{"code":"PORTAL_CHANGED","message":"The operation could not be completed safely.","retryable":false}}\n');
  });

  it('uses the stable authorization-denied exit code', async () => {
    const stderr = vi.fn();
    expect(await runCli(
      ['bci-pyme', 'businesses', 'list', '--profile', 'testing'],
      {
        openSessionPortal: vi.fn().mockRejectedValue(new PortalError('AUTHORIZATION_DENIED', 'Synthetic denial.')),
        login: vi.fn(), stdout: vi.fn(), stderr,
      },
    )).toBe(5);
    expect(stderr).toHaveBeenCalledWith('{"error":{"code":"AUTHORIZATION_DENIED","message":"Synthetic denial.","retryable":false}}\n');
  });
});
