import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { listSagOptions } from '../../../services/sag/src/tasks/options.js';
import { sagOptionGroups } from '../../../services/sag/src/tasks/options.js';

vi.mock('../../../services/sag/src/portal/catalogs.js', () => ({
  readSagCatalogs: vi.fn(() => Promise.resolve({
    countries: [{ id: '901', label: 'Synthetic country' }],
    genders: [{ id: '902', label: 'Synthetic gender' }],
    documents: [{ id: '903', label: 'Synthetic document' }],
    entryModes: [{ id: '904', label: 'Synthetic mode A' }, { id: '905', label: 'Synthetic mode B' }],
    transports: [{ id: '906', label: 'Synthetic transport A' }, { id: '907', label: 'Synthetic transport B' }],
    borderControls: [
      { id: '908', label: 'Synthetic control A', active: true, entryMode: '904', advanceDays: 2, declarationType: '1' },
      { id: '909', label: 'Synthetic control B', active: true, entryMode: '905', advanceDays: 1, declarationType: '2' },
      { id: '910', label: 'Synthetic inactive control', active: false, entryMode: '904', advanceDays: 2, declarationType: '1' },
    ],
    transportLinks: [
      { borderControl: '908', transportType: '906' },
      { borderControl: '909', transportType: '907' },
    ],
  })),
}));

describe('SAG public CLI', () => {
  it('keeps complete dependent choices scoped to their parents and rejects unsafe or incomplete commands', async () => {
    const { readSagCatalogs } = await import('../../../services/sag/src/portal/catalogs.js');
    const stdout = vi.fn();
    const stderr = vi.fn();
    const login = vi.fn();
    const openSessionPortal = vi.fn();
    const dependencies = { stdout, stderr, login, openSessionPortal };
    expect(await runCli(['sag', 'declaracion-jurada', 'options'], dependencies)).toBe(0);
    expect(stdout).toHaveBeenCalledOnce();
    const result: unknown = (JSON.parse(String(stdout.mock.calls[0]?.[0])) as { result: unknown }).result;
    expect(result).toMatchObject({ catalogs: [
      { field: 'nationality' }, { field: 'origin-country' }, { field: 'gender' },
      { field: 'travel-document' }, { field: 'entry-mode' },
      { field: 'border-control', dependsOn: { entryMode: '904' }, options: [{ id: '908' }] },
      { field: 'border-control', dependsOn: { entryMode: '905' }, options: [{ id: '909' }] },
      { field: 'transport-type', dependsOn: { borderControl: '908' }, options: [{ id: '906' }] },
      { field: 'transport-type', dependsOn: { borderControl: '909' }, options: [{ id: '907' }] },
      { field: 'arrival-date', dependsOn: { borderControl: '908' } },
      { field: 'arrival-date', dependsOn: { borderControl: '909' } },
      { field: 'auth-method' }, { field: 'minors-luggage' }, { field: 'sag-products' },
    ] });
    stdout.mockClear();
    expect(await runCli(['sag', 'declaracion-jurada', 'options', 'transport-type', '--border-control', '908'], dependencies)).toBe(0);
    expect(stdout).toHaveBeenCalledOnce();
    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toMatchObject({ schemaVersion: '1', service: 'sag', operation: 'declaracion-jurada.options', result: { field: 'transport-type', dependsOn: { borderControl: '908' }, options: [{ id: '906', label: 'Synthetic transport A', aliases: [] }] } });
    vi.mocked(readSagCatalogs).mockClear();
    stdout.mockClear();
    for (const args of [
      ['options', 'border-control'], ['options', 'transport-type'],
      ['options', 'unknown'], ['options', '--entry-mode', '904'],
      ['options', '--password', 'synthetic-secret'], ['submit'],
    ]) {
      expect(await runCli(['sag', 'declaracion-jurada', ...args], dependencies)).toBe(2);
    }
    expect(readSagCatalogs).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
    expect(openSessionPortal).not.toHaveBeenCalled();
    await expect(listSagOptions({ field: 'transport-type', borderControl: '910' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('uses the Chilean calendar day and each control advance window across a month boundary', async () => {
    const { readSagCatalogs } = await import('../../../services/sag/src/portal/catalogs.js');
    const groups = sagOptionGroups(await readSagCatalogs(), new Date('2032-05-01T01:00:00Z'));
    expect(groups.filter(group => group.field === 'arrival-date')).toEqual([
      { field: 'arrival-date', dependsOn: { borderControl: '908' }, options: [
        { id: '2032-04-30', label: '2032-04-30', aliases: [] },
        { id: '2032-05-01', label: '2032-05-01', aliases: [] },
      ] },
      { field: 'arrival-date', dependsOn: { borderControl: '909' }, options: [
        { id: '2032-04-30', label: '2032-04-30', aliases: [] },
      ] },
    ]);
  });
});
