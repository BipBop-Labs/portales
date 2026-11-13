import { expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import { countAcrossFrames } from '../src/portal/page-state.js';

it('ignores a frame detached during structural inspection, not live-frame errors', async () => {
  const detached = { isDetached: () => true, locator: () => ({ all: () => Promise.reject(new Error('synthetic detached frame')) }) };
  const main = { isDetached: () => false, locator: () => ({ all: () => Promise.resolve([{ isVisible: () => Promise.resolve(true) }]) }) };
  const page = { frames: () => [detached, main] } as unknown as Page;
  expect(await countAcrossFrames(page, { css: '#synthetic-control' })).toBe(1);
  const liveFailure = { isDetached: () => false, locator: () => ({ all: vi.fn().mockRejectedValue(new Error('synthetic live failure')) }) };
  await expect(countAcrossFrames({ frames: () => [liveFailure] } as unknown as Page, { css: '#synthetic-control' })).rejects.toThrow('synthetic live failure');
});
