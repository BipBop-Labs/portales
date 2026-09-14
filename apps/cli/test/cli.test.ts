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

  it('rejects unsupported login arguments before accessing authentication', async () => {
    const login = vi.fn();
    const openSessionPortal = vi.fn();
    expect(await runCli([
      'bci-pyme', 'auth', 'login', '--profile', 'testing', '--unsupported-option',
    ], { login, openSessionPortal, stdout: vi.fn(), stderr: vi.fn() })).toBe(2);
    expect(login).not.toHaveBeenCalled();
    expect(openSessionPortal).not.toHaveBeenCalled();
  });

  it('keeps credential setup separate from login and rejects credential arguments', async () => {
    const setup = vi.fn().mockResolvedValue({ configured: true, profile: 'testing' });
    const login = vi.fn();
    const openSessionPortal = vi.fn();
    const stdout = vi.fn();
    const dependencies = { setup, login, openSessionPortal, stdout, stderr: vi.fn() };
    expect(await runCli([
      'bci-pyme', 'auth', 'setup', '--profile', 'testing',
    ], dependencies)).toBe(0);
    expect(setup).toHaveBeenCalledWith({ profile: 'testing' });
    expect(stdout).toHaveBeenCalledWith('{"configured":true,"profile":"testing"}\n');
    expect(await runCli([
      'bci-pyme', 'auth', 'setup', '--profile', 'testing', '--password', 'synthetic-secret',
    ], dependencies)).toBe(2);
    expect(setup).toHaveBeenCalledOnce();
    expect(login).not.toHaveBeenCalled();
    expect(openSessionPortal).not.toHaveBeenCalled();
  });

  it('discovers every recipient bank for the exact business without logging in', async () => {
    const portal = {
      requireAuthenticatedSession: vi.fn().mockResolvedValue(undefined),
      discoverBusinesses: vi.fn().mockResolvedValue([{ id: 'synthetic-business', label: 'Synthetic Business' }]),
      discoverRecipientBanks: vi.fn().mockResolvedValue([
        { id: 'synthetic-bank-a', label: 'Synthetic Bank A' },
        { id: 'synthetic-bank-b', label: 'Synthetic Bank B' },
      ]),
      close: vi.fn(),
    };
    const login = vi.fn();
    const stdout = vi.fn();
    const dependencies = { openSessionPortal: vi.fn().mockResolvedValue(portal), login, stdout, stderr: vi.fn() };
    expect(await runCli([
      'bci-pyme', 'destinatarios', 'options', '--profile', 'testing', '--business-id', 'synthetic-business',
    ], dependencies)).toBe(0);
    expect(JSON.parse(stdout.mock.calls[0]?.[0] as string)).toEqual({
      field: 'bank-id', dependsOn: { businessId: 'synthetic-business' }, options: [
        { id: 'synthetic-bank-a', label: 'Synthetic Bank A', aliases: [] },
        { id: 'synthetic-bank-b', label: 'Synthetic Bank B', aliases: [] },
      ],
    });
    expect(portal.discoverRecipientBanks).toHaveBeenCalledExactlyOnceWith('synthetic-business');
    expect(await runCli([
      'bci-pyme', 'destinatarios', 'options', '--profile', 'testing', '--business-id', 'unlisted-business',
    ], dependencies)).toBe(2);
    expect(portal.discoverRecipientBanks).toHaveBeenCalledOnce();
    expect(login).not.toHaveBeenCalled();
    expect(portal.close).toHaveBeenCalledTimes(2);
  });

  it('lists both recipient statuses only for a discovered business without authentication or writes', async () => {
    const recipients = [
      { status: 'authorized', name: 'Synthetic Recipient Alpha', alias: 'Synthetic A', rut: 'synthetic-rut-a', email: '', bank: 'Synthetic Bank', accountNumber: '00000001' },
      { status: 'pending', name: 'Synthetic Recipient Beta', alias: 'Synthetic B', rut: 'synthetic-rut-b', email: '', bank: 'Synthetic Bank', accountNumber: '00000002' },
    ];
    const portal = {
      requireAuthenticatedSession: vi.fn().mockResolvedValue(undefined),
      discoverBusinesses: vi.fn().mockResolvedValue([{ id: 'synthetic-business', label: 'Synthetic Business' }]),
      listRecipients: vi.fn().mockResolvedValue(recipients),
      close: vi.fn(),
    };
    const login = vi.fn();
    const stdout = vi.fn();
    const dependencies = { openSessionPortal: vi.fn().mockResolvedValue(portal), login, stdout, stderr: vi.fn() };
    const args = ['bci-pyme', 'destinatarios', 'list', '--profile', 'testing', '--business-id'];
    expect(await runCli([...args, 'synthetic-business'], dependencies)).toBe(0);
    expect(JSON.parse(stdout.mock.calls[0]?.[0] as string)).toEqual({ businessId: 'synthetic-business', recipients });
    expect(portal.listRecipients).toHaveBeenCalledExactlyOnceWith('synthetic-business');
    expect(await runCli([...args, 'unlisted-business'], dependencies)).toBe(2);
    expect(portal.listRecipients).toHaveBeenCalledOnce();
    expect(login).not.toHaveBeenCalled();
    expect(portal.close).toHaveBeenCalledTimes(2);
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
