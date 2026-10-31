import type { Locator } from 'playwright';
import { PortalError } from './errors.js';

/** Waits for a control and requires exactly one visible match; anything else is a changed portal. */
export async function requireUnique(locator: Locator, description: string, timeout = 30_000): Promise<Locator> {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
  } catch {
    throw new PortalError('PORTAL_CHANGED', `Expected exactly one ${description}.`);
  }
  const visible: Locator[] = [];
  for (const candidate of await locator.all()) {
    if (await candidate.isVisible()) visible.push(candidate);
  }
  if (visible.length !== 1) {
    throw new PortalError('PORTAL_CHANGED', `Expected exactly one ${description}.`);
  }
  return visible[0] as Locator;
}
