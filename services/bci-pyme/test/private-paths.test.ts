import { describe, expect, it } from 'vitest';
import { browserLaunchOptions, privateBciPaths } from '../src/portal/playwright-portal.js';

describe('private browser state', () => {
  it('isolates service and profile outside the repository', () => {
    const paths = privateBciPaths('synthetic-profile', '/private/state', '/private/data');
    expect(paths).toEqual({
      profileDirectory: '/private/state/portales/bci-pyme/synthetic-profile/browser',
      downloadDirectory: '/private/data/portales/bci-pyme/synthetic-profile/downloads',
    });
  });

  it('rejects profile names that could escape their directory', () => {
    expect(() => privateBciPaths('../escape', '/private/state', '/private/data')).toThrow();
    try {
      privateBciPaths('../escape', '/private/state', '/private/data');
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: 'INVALID_INPUT' });
    }
  });

  it('uses installed Chrome and an explicitly configured proxy', () => {
    expect(browserLaunchOptions('socks5://127.0.0.1:40000')).toMatchObject({
      channel: 'chrome',
      headless: false,
      proxy: { server: 'socks5://127.0.0.1:40000' },
    });
    expect(browserLaunchOptions(undefined)).not.toHaveProperty('proxy');
  });
});
