import { EventEmitter } from 'node:events';
import { chromium, type BrowserContext } from 'playwright';
import { PlaywrightBciPymePortal } from '../src/portal/playwright-portal.js';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { openBrowserSession, saveBrowserSession } from '../src/portal/browser-session.js';

it('preserves only BCI session state privately and restores it into a clean profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'portales-session-synthetic-'));
  const session = {
    name: 'synthetic-session', value: 'synthetic-value', domain: 'bel.bci.cl', path: '/',
    expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' as const,
  };
  const persistent = { ...session, name: 'synthetic-persistent', expires: 9999999999 };
  const origin = { origin: 'https://bel.bci.cl', localStorage: [{ name: 'synthetic-key', value: 'synthetic-value' }] };
  const context = Object.assign(new EventEmitter(), {
    setStorageState: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  });
  const launch = vi.spyOn(chromium, 'launchPersistentContext')
    .mockResolvedValue(context as unknown as BrowserContext);
  try {
    await saveBrowserSession({ storageState: vi.fn().mockResolvedValue({
      cookies: [session, persistent, { ...session, domain: 'synthetic.invalid' }],
      origins: [origin, { ...origin, origin: 'https://synthetic.invalid' }],
    }) }, root);
    const path = join(root, 'session-state.json');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const expected = { cookies: [session, persistent], origins: [origin] };
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(expected);
    await openBrowserSession(root, { headless: false });
    expect(context.setStorageState).toHaveBeenCalledExactlyOnceWith(expected);
    expect(launch.mock.calls[0]?.[0]).not.toBe(root);
    context.emit('close');
    context.setStorageState.mockClear();
    await openBrowserSession(join(root, 'another-profile'), { headless: false });
    expect(context.setStorageState).not.toHaveBeenCalled();
    context.emit('close');
    await writeFile(path, JSON.stringify({ ...expected, cookies: [{ ...session, domain: 'synthetic.invalid' }] }));
    await expect(openBrowserSession(root, {})).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(context.setStorageState).not.toHaveBeenCalled();
  } finally {
    launch.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

it('does not obscure a cancelled download by checkpointing an already closed browser', async () => {
  const root = await mkdtemp(join(tmpdir(), 'portales-closed-session-synthetic-'));
  vi.stubEnv('XDG_STATE_HOME', root);
  vi.stubEnv('XDG_DATA_HOME', root);
  const context = Object.assign(new EventEmitter(), {
    pages: () => [{ goto: vi.fn().mockResolvedValue(undefined) }],
    storageState: vi.fn().mockRejectedValue(new Error('synthetic closed context')),
    close: vi.fn().mockResolvedValue(undefined),
  });
  const launch = vi.spyOn(chromium, 'launchPersistentContext')
    .mockResolvedValue(context as unknown as BrowserContext);
  try {
    const portal = await PlaywrightBciPymePortal.open('synthetic-profile');
    context.emit('close');
    await expect(portal.close()).resolves.toBeUndefined();
    expect(context.storageState).not.toHaveBeenCalled();
  } finally {
    launch.mockRestore();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
