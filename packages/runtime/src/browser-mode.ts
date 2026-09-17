/** How a browser-backed command actually renders. Reported in events, results, and run records. */
export type BrowserMode = 'headed-xvfb' | 'headed-desktop' | 'headless' | 'none';

export type BrowserRequirement = 'none' | 'headed' | 'headless';

export function browserModeFor(
  requirement: BrowserRequirement,
  env: NodeJS.ProcessEnv = process.env,
): BrowserMode {
  if (requirement === 'none') return 'none';
  if (requirement === 'headless') return 'headless';
  if (env.PORTALES_XVFB_ACTIVE === '1') return 'headed-xvfb';
  return 'headed-desktop';
}
