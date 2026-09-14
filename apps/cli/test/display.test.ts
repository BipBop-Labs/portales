import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { runWithVirtualDisplayIfNeeded } from '../src/display.js';

describe('BCI virtual display regression', () => {
  it('wraps only headless Linux BCI commands with xvfb-run', async () => {
    const spawn = vi.fn(() => ({
      once(event: 'error' | 'exit', listener: ((error: Error) => void) | ((code: number, signal: null) => void)) {
        if (event === 'exit') {
          queueMicrotask(() => {
            (listener as (code: number, signal: null) => void)(0, null);
          });
        }
      },
    }));

    const result = runWithVirtualDisplayIfNeeded(
      ['bci-pyme', 'businesses', 'list', '--profile', 'default'],
      {
        env: {},
        platform: 'linux',
        executable: '/synthetic/node',
        entrypoint: '/synthetic/main.js',
        spawn,
      },
    );

    expect(result).not.toBeNull();
    await expect(result).resolves.toBe(0);
    expect(spawn).toHaveBeenCalledWith(
      'xvfb-run',
      ['-a', '/synthetic/node', '/synthetic/main.js', 'bci-pyme', 'businesses', 'list', '--profile', 'default'],
      { stdio: 'inherit', env: { PORTALES_XVFB_ACTIVE: '1' }, detached: true },
    );
    expect(runWithVirtualDisplayIfNeeded(['sii', 'auth', 'status'], {
      env: {}, platform: 'linux', spawn,
    })).toBeNull();
    expect(runWithVirtualDisplayIfNeeded(['bci-pyme', 'businesses', 'list'], {
      env: { DISPLAY: ':1' }, platform: 'linux', spawn,
    })).toBeNull();
    expect(runWithVirtualDisplayIfNeeded(['bci-pyme', 'businesses', 'list'], {
      env: { PORTALES_XVFB_ACTIVE: '1' }, platform: 'linux', spawn,
    })).toBeNull();
  });

  it('forwards termination to the complete Xvfb process group', async () => {
    const child = new EventEmitter() as EventEmitter & { pid: number };
    child.pid = 321;
    const signalSource = new EventEmitter();
    const killProcessGroup = vi.fn();
    const result = runWithVirtualDisplayIfNeeded(['bci-pyme', 'businesses', 'list'], {
      env: {},
      platform: 'linux',
      executable: '/synthetic/node',
      entrypoint: '/synthetic/main.js',
      spawn: vi.fn(() => child),
      signalSource,
      killProcessGroup,
    });

    signalSource.emit('SIGTERM');
    signalSource.emit('SIGTERM');
    expect(killProcessGroup).toHaveBeenCalledTimes(2);
    expect(killProcessGroup).toHaveBeenNthCalledWith(1, -321, 'SIGTERM');
    expect(killProcessGroup).toHaveBeenNthCalledWith(2, -321, 'SIGTERM');
    child.emit('exit', null, 'SIGTERM');
    await expect(result).resolves.toBe(143);
    expect(signalSource.listenerCount('SIGINT')).toBe(0);
    expect(signalSource.listenerCount('SIGTERM')).toBe(0);
  });

  it('maps Xvfb launch failures to the stable CLI error contract', async () => {
    const child = new EventEmitter();
    const writes: string[] = [];
    const result = runWithVirtualDisplayIfNeeded(['bci-pyme', 'businesses', 'list'], {
      env: {},
      platform: 'linux',
      executable: '/synthetic/node',
      entrypoint: '/synthetic/main.js',
      spawn: vi.fn(() => child),
      signalSource: new EventEmitter(),
      stderr: (value) => writes.push(value),
    });

    child.emit('error', new Error('spawn xvfb-run ENOENT /private/internal/path'));

    await expect(result).resolves.toBe(7);
    expect(writes).toEqual([
      '{"error":{"code":"PORTAL_CHANGED","message":"The operation could not be completed safely.","retryable":false}}\n',
    ]);
    expect(writes[0]).not.toContain('ENOENT');
    expect(writes[0]).not.toContain('/private/internal/path');
  });
});
