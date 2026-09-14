import { expect, it } from 'vitest';
import { recipientBankMatches } from '../src/portal/recipient-bank.js';

it('matches the observed Santander catalog/detail label difference without accepting arbitrary bank changes', () => {
  expect(recipientBankMatches('Banco Santander-santiago', 'Banco Santander / santiago')).toBe(true);
  expect(recipientBankMatches('Synthetic Bank A', 'Synthetic Bank A')).toBe(true);
  expect(recipientBankMatches('Synthetic Bank B', 'Synthetic Bank A')).toBe(false);
  expect(recipientBankMatches('Banco Santander', 'Banco Santander / santiago')).toBe(false);
});
