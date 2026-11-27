import { describe, expect, it } from 'vitest';
import { chileMidnight, movementsFrom } from '../src/portal/movements.js';
import { movementRange } from '../src/tasks/cuentas.js';

// Synthetic values only; shapes observed 2026-10-30.
const movement = { id: 'X1', fechaContable: '01/10/2026', descripcion: ' Pago ficticio ', canal: 'Internet', tipo: 'cargo', monto: '1500', saldo: '98500', numeroDocumento: '', detalleGlosa: ['', 'detalle ficticio'] };

describe('movements', () => {
  it('sends the date filter as Chile midnight, as the portal UI does', () => {
    expect(chileMidnight('2026-09-14')).toBe('2026-09-14T03:00:00.000Z');
    expect(chileMidnight('2026-07-01')).toBe('2026-07-01T04:00:00.000Z');
  });

  it('rejects ranges the portal answers with HTTP 500 before opening a browser', () => {
    expect(movementRange({ from: '2026-09-01', to: '2026-10-16' })).toEqual({ from: '2026-09-01', to: '2026-10-16' });
    expect(() => movementRange({ from: '2026-06-01', to: '2026-09-14' })).toThrow(/at most 45 days/u);
    expect(() => movementRange({ from: '2026-10-02', to: '2026-10-01' })).toThrow(/not be after/u);
    expect(() => movementRange({ from: '2026-02-30' })).toThrow(/YYYY-MM-DD/u);
    expect(movementRange({})).toBeNull();
    expect(movementRange({ from: '2026-10-20' }, new Date('2026-10-31T01:00:00Z'))).toEqual({ from: '2026-10-20', to: '2026-10-30' });
  });

  it('maps movements and refuses a partial page', () => {
    const ok = movementsFrom({ moneda: 'CLP', movimientos: [movement], pagina: [{ totalRegistros: '1', masPaginas: 'N' }] });
    expect(ok.movements[0]).toEqual({ id: 'X1', date: '2026-10-01', direction: 'debit', amount: 1500, balance: 98500, description: 'Pago ficticio', channel: 'Internet', details: ['detalle ficticio'], documentNumber: null });
    expect(() => movementsFrom({ moneda: 'CLP', movimientos: [movement], pagina: [{ totalRegistros: '150', masPaginas: 'S' }] })).toThrow(/shorter range/u);
  });
});
