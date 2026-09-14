import { describe, expect, it, vi } from 'vitest';
import { downloadCartolas } from '../src/tasks/cartolas-download.js';
import { listAccountOptions } from '../src/tasks/options.js';

describe('selector discovery', () => {
  it('returns the complete account catalog with its business dependency', async () => {
    const portal = {
      requireAuthenticatedSession: vi.fn().mockResolvedValue(undefined),
      discoverBusinesses: vi.fn().mockResolvedValue([
        { id: 'business-synthetic-a', label: 'Empresa Sintética Uno' },
      ]),
      discoverRecipientBanks: vi.fn(),
      listRecipients: vi.fn(),
      prepareRecipientCreation: vi.fn(),
      createRecipient: vi.fn(),
      authorizeRecipient: vi.fn(),
      deleteRecipient: vi.fn(),
      discoverAccounts: vi.fn().mockResolvedValue([
        { id: 'account-synthetic-a', label: 'Cuenta Sintética Uno' },
        { id: 'account-synthetic-b', label: 'Cuenta Sintética Dos' },
      ]),
    };

    await expect(
      listAccountOptions({ profile: 'testing', businessId: 'business-synthetic-a' }, portal),
    ).resolves.toEqual({
      field: 'account-id',
      dependsOn: { businessId: 'business-synthetic-a' },
      options: [
        { id: 'account-synthetic-a', label: 'Cuenta Sintética Uno', aliases: [] },
        { id: 'account-synthetic-b', label: 'Cuenta Sintética Dos', aliases: [] },
      ],
    });
    expect(portal.discoverAccounts).toHaveBeenCalledWith('business-synthetic-a');
  });
});

describe('cartolas.download', () => {
  it('validates discovered IDs and delegates one download without login', async () => {
    const portal = {
      requireAuthenticatedSession: vi.fn().mockResolvedValue(undefined),
      discoverBusinesses: vi.fn().mockResolvedValue([
        { id: 'business-synthetic-a', label: 'Empresa Sintética Uno' },
      ]),
      discoverRecipientBanks: vi.fn(),
      listRecipients: vi.fn(),
      prepareRecipientCreation: vi.fn(),
      createRecipient: vi.fn(),
      authorizeRecipient: vi.fn(),
      deleteRecipient: vi.fn(),
      discoverAccounts: vi.fn().mockResolvedValue([
        { id: 'account-synthetic-a', label: 'Cuenta Sintética Uno' },
      ]),
      downloadCartola: vi.fn().mockResolvedValue({
        path: '/private/synthetic/cartola.xlsx',
        mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        byteCount: 30,
        sha256: 'a'.repeat(64),
      }),
    };

    await downloadCartolas(
      {
        profile: 'testing',
        selections: [{
          businessId: 'business-synthetic-a',
          accountId: 'account-synthetic-a',
          documentType: 'excel-detallado',
        }],
      },
      portal,
    );

    expect(portal.downloadCartola).toHaveBeenCalledOnce();
    expect(Object.keys(portal)).not.toContain('login');
  });
});
