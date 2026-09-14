import { describe, expect, it, vi } from 'vitest';
import { SecretToolReader } from '../src/secret-service.js';

describe('Secret Service reader', () => {
  it('captures secret-tool stdout and never inherits output or stderr', async () => {
    const invoke = vi.fn().mockResolvedValue({ stdout: Buffer.from('synthetic-secret\n'), exitCode: 0 });
    const reader = new SecretToolReader(invoke);
    await expect(reader.read({ service: 'cl.bipbop.portales.bci', account: 'synthetic-profile' }))
      .resolves.toBe('synthetic-secret');
    expect(invoke).toHaveBeenCalledWith(
      'secret-tool',
      ['lookup', 'service', 'cl.bipbop.portales.bci', 'account', 'synthetic-profile'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  });
});
