import { describe, expect, it } from 'vitest';
import { canonicalRut, isValidRut, rutDigits, sameRut } from '../src/rut.js';

// Synthetic RUTs with valid check digits.
describe('rut', () => {
  it('accepts every common form and returns one canonical form', () => {
    for (const form of ['11.111.111-1', '11111111-1', '111111111', ' 11.111.111-1 ']) {
      expect(canonicalRut(form)).toBe('11111111-1');
    }
    expect(canonicalRut('10.000.013-k')).toBe('10000013-K');
    expect(rutDigits('10.000.013-k')).toBe('10000013K');
  });

  it('compares RUTs whatever their formatting and rejects invalid check digits', () => {
    expect(sameRut('11.111.111-1', '111111111')).toBe(true);
    expect(sameRut('11111111-2', '11111111-2')).toBe(false);
    expect(isValidRut('11111111-2')).toBe(false);
  });
});
