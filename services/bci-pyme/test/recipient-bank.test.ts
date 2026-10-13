import { expect, it } from 'vitest';
import { recipientBankMatches } from '../src/portal/recipient-bank.js';

it('matches the observed Santander catalog/detail label difference without accepting arbitrary bank changes', () => {
  expect(recipientBankMatches('Banco Santander-santiago', 'Banco Santander / santiago')).toBe(true);
  expect(recipientBankMatches('Synthetic Bank A', 'Synthetic Bank A')).toBe(true);
  expect(recipientBankMatches('Synthetic Bank B', 'Synthetic Bank A')).toBe(false);
  expect(recipientBankMatches('Banco Santander', 'Banco Santander / santiago')).toBe(false);
});

it('matches only the observed Chile catalog/detail label pair, not arbitrary punctuation variants', () => {
  expect(recipientBankMatches('Banco De Chile-edwards', 'Banco De Chile / edwards')).toBe(true);
  expect(recipientBankMatches('Banco De Chile', 'Banco De Chile / edwards')).toBe(false);
  expect(recipientBankMatches('Banco De Chile / edwards', 'Banco De Chile-edwards')).toBe(false);
  expect(recipientBankMatches('Banco De Chile - edwards', 'Banco De Chile / edwards')).toBe(false);
  expect(recipientBankMatches('Synthetic Bank A-edwards', 'Synthetic Bank A / edwards')).toBe(false);
  expect(recipientBankMatches('Banco De Chile-edwards', 'Banco Santander / santiago')).toBe(false);
});
