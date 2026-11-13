import { expect, it, vi } from 'vitest';
import { dismissOptionalBciCookies } from '../src/portal/playwright-portal.js';

it('rejects only the observed optional cookies and waits for the covering control to disappear', async () => {
  const button = { count: vi.fn().mockResolvedValue(1), isVisible: vi.fn().mockResolvedValue(true), click: vi.fn(), waitFor: vi.fn() };
  const getByRole = vi.fn().mockReturnValue(button);
  expect(await dismissOptionalBciCookies({ getByRole })).toBe(true);
  expect(getByRole).toHaveBeenCalledWith('button', { name: 'Rechazar opcionales', exact: true });
  expect(button.click).toHaveBeenCalledExactlyOnceWith();
  expect(button.waitFor).toHaveBeenCalledWith({ state: 'hidden', timeout: 10_000 });
});

it('does not click when the cookie choice is already absent', async () => {
  const button = { count: vi.fn().mockResolvedValue(0), click: vi.fn() };
  expect(await dismissOptionalBciCookies({ getByRole: vi.fn().mockReturnValue(button) })).toBe(false);
  expect(button.click).not.toHaveBeenCalled();
});
