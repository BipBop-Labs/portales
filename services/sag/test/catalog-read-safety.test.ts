import type { Route } from 'playwright';
import { expect, it, vi } from 'vitest';
import { routeCatalogRead } from '../src/portal/catalogs.js';

it('blocks declaration creation and every request outside the observed GET allowlist', async () => {
  for (const [method, url, allowed] of [
    ['GET', 'https://dj.sag.gob.cl/declaracion-jurada', true],
    ['GET', 'https://djapi.sag.gob.cl/paises', true],
    ['POST', 'https://djapi.sag.gob.cl/declaracionJurada/', false],
    ['POST', 'https://djapi.sag.gob.cl/paises', false],
    ['GET', 'https://djapi.sag.gob.cl/declaracionJurada/', false],
    ['GET', 'https://synthetic.invalid/paises', false],
    ['GET', 'https://djapi.sag.gob.cl/paises?synthetic=1', false],
  ] as const) {
    const proceed = vi.fn(() => Promise.resolve());
    const abort = vi.fn(() => Promise.resolve());
    // Only Route's request/continue/abort surface participates in this fragile safety boundary.
    const route = {
      request: () => ({ method: () => method, url: () => url }), continue: proceed, abort,
    } as unknown as Route;
    await routeCatalogRead(route);
    expect(proceed).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(abort).toHaveBeenCalledTimes(allowed ? 0 : 1);
  }
});
