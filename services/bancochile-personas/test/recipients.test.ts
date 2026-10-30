import { describe, expect, it } from 'vitest';
import { recipientsFromPages } from '../src/portal/recipients.js';
import { matchesName } from '../src/tasks/destinatarios.js';

// Synthetic values only. Shape observed 2026-10-30: pages are cut by accounts, `paginas` is the
// current page number and `totalItems` counts accounts, not recipients.
const account = (id: string) => ({
  identificadorCuenta: id, banco: 'BANCO FICTICIO', codigoBanco: '999', nombreTipoCuenta: 'Cuenta Vista',
  nroCuenta: `000${id}`, alias: null, email: 'persona@example.test', esFavorito: false,
});
const recipient = (id: number, accounts: string[]) => ({
  id, nombreRazonSocial: `Persona Ficticia ${String(id)}`, rutBeneficiario: '11111111-1', fechaCreacion: null,
  cuentas: accounts.map(account),
});
const page = (current: number, more: boolean, totalItems: number, recipients: ReturnType<typeof recipient>[]) => ({
  beneficiarios: recipients, pagina: { masPaginas: more, paginas: current, totalItems },
});

describe('recipientsFromPages', () => {
  it('merges a recipient whose accounts continue on the next page', () => {
    const result = recipientsFromPages([
      page(1, true, 3, [recipient(1, ['a']), recipient(2, ['b'])]),
      page(2, false, 3, [recipient(2, ['c'])]),
    ]);
    expect(result.map((item) => [item.id, item.accounts.map((entry) => entry.accountId)])).toEqual([['1', ['a']], ['2', ['b', 'c']]]);
  });

  it('rejects a read that does not match the reported account count', () => {
    expect(() => recipientsFromPages([page(1, false, 4, [recipient(1, ['a', 'b'])])])).toThrow(/reported 4 accounts and 2 were read/u);
  });

  it('reports a changed response shape as a contract mismatch', () => {
    expect(() => recipientsFromPages([{ beneficiarios: [{ id: 'x' }], pagina: {} }])).toThrow(/Contract mismatch/u);
  });
});

describe('matchesName', () => {
  it('matches every query word ignoring case and accents', () => {
    expect(matchesName('MARÍA JOSÉ PÉREZ FICTICIA', 'maria perez')).toBe(true);
    expect(matchesName('MARÍA JOSÉ PÉREZ FICTICIA', 'maria soto')).toBe(false);
    expect(matchesName('MARÍA JOSÉ PÉREZ FICTICIA', '  ')).toBe(false);
  });
});
