import { describe, expect, it } from 'vitest';
import { controlLocator } from '../src/portal/page-state.js';

/** Regression (2026-09-17): the live download button's accessible name is "Descargar" plus an icon glyph; the contract records it with exact: false. */
describe('contract control locator', () => {
  function fakeScope() {
    const calls: unknown[][] = [];
    return { calls, scope: { getByRole: (...args: unknown[]) => { calls.push(args); return {}; }, getByText: () => ({}), locator: () => ({}) } };
  }
  it('matches role names exactly unless the contract records exact: false', () => {
    const strict = fakeScope();
    controlLocator(strict.scope as never, { role: 'button', name: 'Descargar' });
    expect(strict.calls).toEqual([['button', { name: 'Descargar', exact: true }]]);
    const substring = fakeScope();
    controlLocator(substring.scope as never, { role: 'button', name: 'Descargar', exact: false });
    expect(substring.calls).toEqual([['button', { name: 'Descargar', exact: false }]]);
  });
});
