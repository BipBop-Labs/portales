import { describe, expect, it } from 'vitest';
import { summaryShowsAccount } from '../src/portal/transfer.js';
import { newDebit, validateTransfer } from '../src/tasks/transferencias.js';
import type { Movement } from '../src/portal/movements.js';

// Synthetic values only.
const movement = (id: string, direction: Movement['direction'], amount: number): Movement => ({
  id, date: '2026-11-02', direction, amount, balance: 1000, description: 'Traspaso ficticio', channel: 'Internet', details: [], documentNumber: null,
});

describe('transfers', () => {
  it('accepts only whole pesos of at least 1 and short messages before opening a browser', () => {
    expect(validateTransfer({ recipientId: '1', accountId: '2', amount: '1', message: ' hola ' })).toEqual({ recipientId: '1', accountId: '2', amount: 1, message: 'hola' });
    for (const amount of ['0', '1.000', '-5', '2,5', '']) expect(() => validateTransfer({ recipientId: '1', accountId: '2', amount })).toThrow(/whole number/u);
    expect(() => validateTransfer({ recipientId: '1', accountId: '2', amount: '1', message: 'x'.repeat(51) })).toThrow(/at most 50/u);
  });

  it('verifies one new debit of exactly the amount and never guesses between several', () => {
    const before = new Set(['old']);
    expect(newDebit(before, [movement('old', 'debit', 1), movement('new', 'debit', 1)], 1)).toMatchObject({ id: 'new' });
    expect(newDebit(before, [movement('old', 'debit', 1), movement('n', 'credit', 1)], 1)).toBe('none');
    expect(newDebit(before, [movement('a', 'debit', 1), movement('b', 'debit', 1)], 1)).toBe('several');
  });

  it('finds the destination account in the bank summary whatever its separators', () => {
    const summary = 'Origen\nCuenta Corriente ****9999\nMonto\n$ 1\nDestinatario\nPersona Ficticia\nCuenta de destino\n00-123-45678-90\nRut destinatario\n11.111.111-1';
    expect(summaryShowsAccount(summary, '1234567890')).toBe(true);
    expect(summaryShowsAccount(summary, '1234567891')).toBe(false);
  });
});
