import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { PortalError } from '../../../packages/runtime/src/errors.js';
import { configRoot } from '../../../packages/runtime/src/paths.js';
import { transferLimitPath } from '../../../services/bancochile-personas/src/tasks/transferencias.js';

// Synthetic values only.
const recipient = {
  id: '900', name: 'Persona Ficticia', rut: '11111111-1', createdAt: null,
  accounts: [{ accountId: '901', bank: 'Banco Ficticio', bankCode: '999', accountType: 'Cuenta Vista', accountNumber: '0001234567', alias: null, email: null, favorite: false }],
};
const origin = { number: '000999999999', type: 'CUENTA_CORRIENTE', productCode: 'CTD', label: 'Cuenta Corriente', currency: 'CLP', status: null, available: 1000 };
const movement = { id: 'old', date: '2026-01-02', direction: 'debit', amount: 5, balance: 1000, description: 'Ficticio', channel: 'Internet', details: [], documentNumber: null };
const limitPath = transferLimitPath(configRoot());
const args = (amount: string) => ['--profile', 'testing', '--recipient-id', '900', '--account-id', '901', '--amount', amount];

function lastError(stderr: ReturnType<typeof vi.fn>): unknown {
  const lines = stderr.mock.calls.map(call => JSON.parse(call[0] as string) as { error?: unknown });
  return lines.reverse().find(line => line.error !== undefined)?.error;
}

function harness(listMovements = vi.fn().mockResolvedValue({ currency: 'CLP', movements: [movement] })) {
  const portal = {
    listRecipients: vi.fn().mockResolvedValue([recipient]),
    listAccounts: vi.fn().mockResolvedValue([origin]),
    listMovements,
    transfer: vi.fn().mockResolvedValue({ miPass: true }),
    close: vi.fn(),
  };
  const stdout = vi.fn(); const stderr = vi.fn();
  const openBancoChilePortal = vi.fn().mockResolvedValue(portal);
  return { portal, stdout, stderr, openBancoChilePortal, dependencies: { openSessionPortal: vi.fn(), login: vi.fn(), openBancoChilePortal, stdout, stderr } };
}

beforeEach(async () => {
  await mkdir(dirname(limitPath), { recursive: true });
  await writeFile(limitPath, JSON.stringify({ version: 1, maxTransferAmount: 10 }));
  await chmod(limitPath, 0o600);
});
afterEach(() => rm(limitPath, { force: true }));

it('reports a sent transfer whose verification read fails as may-have-applied, never not-sent', async () => {
  const { portal, stdout, stderr, dependencies } = harness(vi.fn()
    .mockResolvedValueOnce({ currency: 'CLP', movements: [movement] })
    .mockRejectedValueOnce(new PortalError('SESSION_EXPIRED', 'Synthetic expiry during verification.')));

  expect(await runCli(['bancochile-personas', 'transferencias', 'prepare', ...args('5')], dependencies)).toBe(0);
  const { confirmation } = (JSON.parse(stdout.mock.calls[0]?.[0] as string) as { result: { confirmation: string } }).result;
  expect(portal.transfer).not.toHaveBeenCalled();

  expect(await runCli(['bancochile-personas', 'transferencias', 'create', ...args('5'), '--confirm', confirmation], dependencies)).toBe(7);
  expect(portal.transfer).toHaveBeenCalledOnce();
  expect(lastError(stderr)).toMatchObject({ code: 'REMOTE_STATE_AMBIGUOUS', writeOutcome: 'may-have-applied', remoteMutationPossible: true });
});

it('refuses transfers above the owner cap, or without a private cap, before opening the bank', async () => {
  const { stderr, openBancoChilePortal, dependencies } = harness();
  expect(await runCli(['bancochile-personas', 'transferencias', 'create', ...args('11'), '--confirm', 'any'], dependencies)).toBe(2);
  expect(lastError(stderr)).toMatchObject({ code: 'INVALID_INPUT', writeOutcome: 'not-sent' });

  await chmod(limitPath, 0o666);
  expect(await runCli(['bancochile-personas', 'transferencias', 'prepare', ...args('5')], dependencies)).toBe(2);
  await rm(limitPath);
  expect(await runCli(['bancochile-personas', 'transferencias', 'prepare', ...args('5')], dependencies)).toBe(2);
  expect(openBancoChilePortal).not.toHaveBeenCalled();
});
