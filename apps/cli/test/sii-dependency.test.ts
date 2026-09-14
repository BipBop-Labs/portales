import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { runSiiDependency } from '../src/sii-dependency.js';

describe('SII dependency bridge', () => {
  it('runs the pinned fork CLI with inherited stdio and forwards its exit code', async () => {
    const child = new EventEmitter();
    const spawn = vi.fn().mockReturnValue(child);
    const result = runSiiDependency(
      ['f29', 'status', '2026-08'],
      { entrypoint: '/repo/services/sii/packages/cli/dist/main.js', spawn },
    );

    child.emit('exit', 6, null);

    await expect(result).resolves.toBe(6);
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      ['/repo/services/sii/packages/cli/dist/main.js', 'f29', 'status', '2026-08'],
      { stdio: 'inherit' },
    );
  });
});
