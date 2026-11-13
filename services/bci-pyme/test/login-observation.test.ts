import { afterEach, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import { PortalError } from '../src/errors.js';
import { observePublicBciLogin } from '../src/portal/login-observation.js';

afterEach(() => { vi.restoreAllMocks(); });

it('labels the failed public-observation phase without exposing browser error text', async () => {
  vi.spyOn(chromium, 'launchPersistentContext').mockRejectedValue(new Error('browserType.launch: SYNTHETIC_PRIVATE_SENTINEL'));
  const error: unknown = await observePublicBciLogin().catch((value: unknown) => value);
  expect(error).toBeInstanceOf(PortalError);
  if (!(error instanceof PortalError)) throw new Error('Expected a typed portal failure.');
  expect(error.code).toBe('BROWSER_LAUNCH_FAILED');
  expect(error.recovery.nextAction).toContain('browser-launch');
  expect(JSON.stringify(error)).not.toContain('SYNTHETIC_PRIVATE_SENTINEL');
});
