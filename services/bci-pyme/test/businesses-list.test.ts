import { describe, expect, it, vi } from 'vitest';
import { listBusinesses } from '../src/tasks/businesses-list.js';

describe('businesses.list', () => {
  it('uses only an existing authenticated session and never logs in', async () => {
    const portal = {
      requireAuthenticatedSession: vi.fn().mockResolvedValue(undefined),
      discoverBusinesses: vi.fn().mockResolvedValue([
        { id: 'business-synthetic-a', label: 'Empresa Sintética Uno' },
      ]),
    };

    await expect(listBusinesses({ profile: 'testing' }, portal)).resolves.toEqual({
      businesses: [{ id: 'business-synthetic-a', label: 'Empresa Sintética Uno' }],
    });
    expect(portal.requireAuthenticatedSession).toHaveBeenCalledOnce();
    expect(portal.discoverBusinesses).toHaveBeenCalledOnce();
    expect(Object.keys(portal)).not.toContain('login');
  });
});
