import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { PortalError } from '../../../services/bci-pyme/src/errors.js';
import type { RecipientProgress } from '../../../services/bci-pyme/src/portal/types.js';

it('previews without writes, binds confirmation, waits for verification, and saves a pending recipient once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'portales-synthetic-recipient-'));
  try {
    const input = join(directory, 'input.json');
    const target = { businessId: 'synthetic-business', bankId: 'synthetic-bank', name: 'Synthetic Recipient', alias: 'Synthetic', rut: '12.345.678-5', accountNumber: '0000000123', email: '', favorite: false };
    await writeFile(input, JSON.stringify(target), { mode: 0o600 });
    const recipient = { status: 'pending', name: target.name, alias: target.alias, rut: target.rut, bank: 'Synthetic Bank', accountNumber: '123', email: '' };
    let saved = false;
    let approve = () => { /* assigned by promise constructor */ };
    let notifyWaiting = () => { /* assigned by promise constructor */ };
    const approval = new Promise<void>(resolve => { approve = resolve; });
    const waiting = new Promise<void>(resolve => { notifyWaiting = resolve; });
    const portal = {
      requireAuthenticatedSession: vi.fn().mockResolvedValue(undefined),
      discoverBusinesses: vi.fn().mockResolvedValue([{ id: target.businessId, label: 'Synthetic Business' }]),
      discoverRecipientBanks: vi.fn().mockResolvedValue([{ id: target.bankId, label: 'Synthetic Bank' }]),
      listRecipients: vi.fn(() => Promise.resolve(saved ? [recipient] : [])),
      prepareRecipientCreation: vi.fn(),
      createRecipient: vi.fn(async (_value: unknown, progress: RecipientProgress) => {
        progress('verifying-created-recipient'); notifyWaiting();
        await approval;
        saved = true;
      }),
      authorizeRecipient: vi.fn(), close: vi.fn(),
    };
    const stdout = vi.fn(); const stderr = vi.fn(); const login = vi.fn();
    const dependencies = { openSessionPortal: vi.fn().mockResolvedValue(portal), stdout, stderr, login };
    const args = ['--profile', 'testing', '--input', input];
    expect(await runCli(['bci-pyme', 'destinatarios', 'prepare', '--action', 'create', ...args], dependencies)).toBe(0);
    const preview = (JSON.parse(stdout.mock.calls[0]?.[0] as string) as { result: { confirmation: string } }).result;
    expect(portal.createRecipient).not.toHaveBeenCalled();
    expect(await runCli(['bci-pyme', 'destinatarios', 'create', ...args, '--confirm', 'wrong'], dependencies)).toBe(8);
    expect(portal.createRecipient).not.toHaveBeenCalled();
    portal.close.mockClear(); stdout.mockClear();
    const run = runCli(['bci-pyme', 'destinatarios', 'create', ...args, '--confirm', preview.confirmation], dependencies);
    await waiting;
    expect(portal.close).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    approve();
    expect(await run).toBe(0);
    expect(portal.createRecipient).toHaveBeenCalledOnce();
    expect(portal.close).toHaveBeenCalledOnce();
    expect((JSON.parse(stdout.mock.calls[0]?.[0] as string) as { result: unknown }).result).toMatchObject({ outcome: 'pending', changed: true, recipient });
    expect(login).not.toHaveBeenCalled();
    // A repeated invocation cannot silently resubmit with a stale preview.
    expect(await runCli(['bci-pyme', 'destinatarios', 'create', ...args, '--confirm', preview.confirmation], dependencies)).toBe(8);
    expect(portal.createRecipient).toHaveBeenCalledOnce();

    saved = false;
    portal.createRecipient.mockRejectedValueOnce(new PortalError('REMOTE_STATE_AMBIGUOUS', 'Synthetic ambiguous submission.'));
    expect(await runCli(['bci-pyme', 'destinatarios', 'create', ...args, '--confirm', preview.confirmation], dependencies)).toBe(7);
    expect(portal.createRecipient).toHaveBeenCalledTimes(2);
    expect(portal.authorizeRecipient).not.toHaveBeenCalled();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('requires target-bound delete confirmation, deletes once, and verifies absence in both statuses', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'portales-synthetic-delete-'));
  try {
    const input = join(directory, 'input.json');
    const target = { businessId: 'synthetic-business', bankId: 'synthetic-bank', rut: '12.345.678-5', accountNumber: '0000000123' };
    await writeFile(input, JSON.stringify(target), { mode: 0o600 });
    const recipient = { status: 'authorized', name: 'Synthetic Recipient', alias: 'Synthetic', rut: target.rut, bank: 'Synthetic Bank', accountNumber: '123', email: '' };
    const portal = {
      requireAuthenticatedSession: vi.fn().mockResolvedValue(undefined),
      discoverBusinesses: vi.fn().mockResolvedValue([{ id: target.businessId, label: 'Synthetic Business' }]),
      discoverRecipientBanks: vi.fn().mockResolvedValue([{ id: target.bankId, label: 'Synthetic Bank' }]),
      listRecipients: vi.fn().mockResolvedValue([recipient]),
      deleteRecipient: vi.fn(), close: vi.fn(),
    };
    const stdout = vi.fn(); const stderr = vi.fn(); const login = vi.fn();
    const dependencies = { openSessionPortal: vi.fn().mockResolvedValue(portal), stdout, stderr, login };
    const args = ['--profile', 'testing', '--input', input];
    expect(await runCli(['bci-pyme', 'destinatarios', 'prepare', '--action', 'delete', ...args], dependencies)).toBe(0);
    const preview = (JSON.parse(stdout.mock.calls[0]?.[0] as string) as { result: { confirmation: string } }).result;
    expect(portal.deleteRecipient).not.toHaveBeenCalled();
    expect(await runCli(['bci-pyme', 'destinatarios', 'delete', ...args, '--confirm', 'wrong'], dependencies)).toBe(8);
    expect(portal.deleteRecipient).not.toHaveBeenCalled();
    stdout.mockClear();
    expect(await runCli(['bci-pyme', 'destinatarios', 'delete', ...args, '--confirm', preview.confirmation], dependencies)).toBe(7);
    expect(stdout).not.toHaveBeenCalled();
    expect(portal.deleteRecipient).toHaveBeenCalledExactlyOnceWith(target.businessId, recipient);
    portal.deleteRecipient.mockImplementationOnce(() => { portal.listRecipients.mockResolvedValue([]); });
    expect(await runCli(['bci-pyme', 'destinatarios', 'delete', ...args, '--confirm', preview.confirmation], dependencies)).toBe(0);
    expect((JSON.parse(stdout.mock.calls[0]?.[0] as string) as { result: unknown }).result).toMatchObject({ outcome: 'deleted', changed: true });
    expect(portal.deleteRecipient).toHaveBeenCalledTimes(2);
    expect(await runCli(['bci-pyme', 'destinatarios', 'delete', ...args, '--confirm', preview.confirmation], dependencies)).toBe(2);
    expect(portal.deleteRecipient).toHaveBeenCalledTimes(2);
    expect(login).not.toHaveBeenCalled();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('authorizes only the selected existing recipient and refuses an unverified approval', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'portales-synthetic-authorization-'));
  try {
    const input = join(directory, 'input.json');
    const target = { businessId: 'synthetic-business', bankId: 'synthetic-bank', rut: '12.345.678-5', accountNumber: '0000000123' };
    await writeFile(input, JSON.stringify(target), { mode: 0o600 });
    const recipient = { status: 'pending', name: 'Synthetic Recipient', alias: 'Synthetic', rut: target.rut, bank: 'Synthetic Bank', accountNumber: '123', email: '' };
    const portal = {
      requireAuthenticatedSession: vi.fn().mockResolvedValue(undefined),
      discoverBusinesses: vi.fn().mockResolvedValue([{ id: target.businessId, label: 'Synthetic Business' }]),
      discoverRecipientBanks: vi.fn().mockResolvedValue([{ id: target.bankId, label: 'Synthetic Bank' }]),
      listRecipients: vi.fn().mockResolvedValue([recipient]),
      prepareRecipientCreation: vi.fn(), createRecipient: vi.fn(),
      authorizeRecipient: vi.fn(), close: vi.fn(),
    };
    const stdout = vi.fn(); const stderr = vi.fn(); const login = vi.fn();
    const dependencies = { openSessionPortal: vi.fn().mockResolvedValue(portal), stdout, stderr, login };
    const args = ['--profile', 'testing', '--input', input];
    expect(await runCli(['bci-pyme', 'destinatarios', 'prepare', '--action', 'authorize', ...args], dependencies)).toBe(0);
    const preview = (JSON.parse(stdout.mock.calls[0]?.[0] as string) as { result: { confirmation: string } }).result;
    stdout.mockClear();
    expect(await runCli(['bci-pyme', 'destinatarios', 'authorize', ...args, '--confirm', preview.confirmation], dependencies)).toBe(7);
    expect(portal.authorizeRecipient).toHaveBeenCalledExactlyOnceWith(target.businessId, recipient, expect.any(Function));
    expect(stdout).not.toHaveBeenCalled();
    expect(portal.createRecipient).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('REMOTE_STATE_AMBIGUOUS'));
    // A separate explicit invocation stays open through phone and bank verification.
    let approve = () => { /* assigned below */ };
    let notifyWaiting = () => { /* assigned below */ };
    const approval = new Promise<void>(resolve => { approve = resolve; });
    const waiting = new Promise<void>(resolve => { notifyWaiting = resolve; });
    portal.authorizeRecipient.mockImplementationOnce(async (_business: string, _recipient: unknown, progress: RecipientProgress) => {
      progress('awaiting-bcipass'); notifyWaiting();
      await approval;
      progress('verifying-bcipass');
      portal.listRecipients.mockResolvedValue([{ ...recipient, status: 'authorized' }]);
    });
    portal.close.mockClear();
    const run = runCli(['bci-pyme', 'destinatarios', 'authorize', ...args, '--confirm', preview.confirmation], dependencies);
    await waiting;
    expect(portal.close).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    approve();
    expect(await run).toBe(0);
    expect((JSON.parse(stdout.mock.calls[0]?.[0] as string) as { result: unknown }).result).toMatchObject({ outcome: 'authorized', changed: true });
    expect(portal.authorizeRecipient).toHaveBeenCalledTimes(2);
    expect(portal.close).toHaveBeenCalledOnce();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
