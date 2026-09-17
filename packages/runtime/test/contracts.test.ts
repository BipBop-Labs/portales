import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { contractSchema, listContractFiles, loadContract, parseContract, validateContractFile } from '../src/contracts.js';
import { classifyPage } from '../src/page-state.js';
import { proposeContractDiff, responseShape, sanitizeAriaSnapshot, sanitizeRoute, sanitizeText } from '../src/observation.js';
import { buildRegistry } from '../../../apps/cli/src/registry.js';

const root = join(import.meta.dirname, '..', '..', '..');

describe('machine-checkable contracts', () => {
  it('validates every contract JSON in the checkout and matches registry operations', async () => {
    const files = await listContractFiles(root);
    expect(files.length).toBeGreaterThanOrEqual(6);
    const registry = buildRegistry();
    for (const path of files) {
      const contract = await validateContractFile(path);
      const service = registry.services.find((item) => item.slug === contract.service);
      expect(service, path).toBeDefined();
      for (const operation of contract.operations) {
        expect(service?.commands.some((command) => command.path.join('.') === operation), `${path} declares ${operation}`).toBe(true);
      }
    }
    for (const service of registry.services) {
      for (const command of service.commands) {
        if (command.contractRef?.endsWith('.json') !== true) continue;
        const loaded = await loadContract(root, service.slug, command.path.join('.'));
        expect(loaded, `${service.slug} ${command.path.join(' ')}`).not.toBeNull();
      }
    }
  });

  it('rejects contracts with query strings, missing states, or unknown fields', () => {
    const base = { schemaVersion: '1', service: 'synthetic', operations: ['thing.list'], observedAt: '2026-01-01', explanation: 'x.md', effect: 'read', pageStates: {}, successConditions: ['a'], stopConditions: ['b'] };
    expect(contractSchema.safeParse(base).success).toBe(true);
    expect(contractSchema.safeParse({ ...base, pageStates: { s: { description: 'd', routeFragments: ['/a?token=1'] } } }).success).toBe(false);
    expect(contractSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(() => parseContract({ ...base, operations: [] })).toThrow(/not a valid portal contract/u);
  });
});

describe('page-state classification', () => {
  const contract = parseContract({
    schemaVersion: '1', service: 'synthetic', operations: ['rows.list'], observedAt: '2026-01-01', explanation: 'x.md', effect: 'read',
    pageStates: {
      'login-page': { description: 'login', kind: 'login-page', routeFragments: ['/login'], controls: [{ css: '#user', expectedVisibleCount: 1 }] },
      selector: { description: 'rows', kind: 'authenticated-shell', routeFragments: ['/selector'], controls: [{ css: 'tr.row', expectedVisibleCount: { min: 1 } }, { role: 'button', name: 'Download', expectedVisibleCount: 1 }] },
    },
    successConditions: ['a'], stopConditions: ['b'],
  });
  it('reports provider errors and blocks before any structural comparison', () => {
    expect(classifyPage(contract, { routePath: '/selector', frameNames: [], controlCounts: {}, markers: ['provider-error'] }).kind).toBe('provider-error');
    expect(classifyPage(contract, { routePath: '/selector', frameNames: [], controlCounts: {}, markers: ['blocked'] }).kind).toBe('blocked');
  });
  it('matches an expected state and otherwise returns the smallest structural diff', () => {
    const ok = classifyPage(contract, { routePath: '/selector', frameNames: [], controlCounts: { 'css tr.row': 3, 'button "Download"': 1 }, markers: [] }, { candidates: ['selector'] });
    expect(ok).toEqual({ kind: 'authenticated-shell', state: 'selector', diff: [] });
    const changed = classifyPage(contract, { routePath: '/selector', frameNames: [], controlCounts: { 'css tr.row': 3, 'button "Download"': 0 }, markers: [] }, { candidates: ['selector'] });
    expect(changed.kind).toBe('changed');
    expect(changed.diff).toEqual(['expected 1 visible button "Download", observed 0']);
    const login = classifyPage(contract, { routePath: '/login', frameNames: [], controlCounts: { '#user': 1, 'css #user': 1 }, markers: [] });
    expect(login.kind).toBe('login-page');
  });
});

describe('observation sanitizer', () => {
  it('strips identifiers, emails, amounts and query strings', () => {
    expect(sanitizeText('Cuenta 12.345.678-5 de persona@example.test saldo $1.234.567 cuenta 0001234567')).toBe('Cuenta <rut> de <email> saldo <amount> cuenta <number>');
    expect(sanitizeRoute('https://portal.example/app/123456/detail?token=abc#x')).toBe('/app/<id>/detail');
    expect(sanitizeAriaSnapshot('- heading "Cuenta 0001234567" [level=1]\n  - text: Saldo $500.000\n  - button "Descargar"')).toBe('- heading "Cuenta <number>"\n  - text: <text>\n  - button "Descargar"');
    expect(responseShape({ status: 200, data: [{ id: 1, nombre: 'x' }] })).toEqual(['data[].id:number', 'data[].nombre:string', 'status:number']);
  });
  it('separates facts from hypotheses in the proposal', () => {
    const contract = parseContract({ schemaVersion: '1', service: 'synthetic', operations: ['rows.list'], observedAt: '2026-01-01', explanation: 'x.md', effect: 'read', pageStates: { selector: { description: 'd', controls: [{ role: 'button', name: 'Download', expectedVisibleCount: 1 }] } }, successConditions: ['a'], stopConditions: ['b'] });
    const proposal = proposeContractDiff('run_20260101000000_00000000', { path: 'synthetic.json', contract }, {
      schemaVersion: '1', runId: 'run_20260101000000_00000000', service: 'synthetic', operation: 'rows.list', observedAt: '2026-01-01T00:00:00Z', browserMode: 'headless', responseFingerprints: {}, stoppedBefore: 'expect-download',
      states: [{ expectedState: 'selector', classification: { kind: 'changed', state: 'selector', diff: ['x'] }, routeFragment: '/selector', frameNames: [], controls: [{ control: 'button "Download"', visibleCount: 0 }], readinessMarkers: [], ariaSnapshot: '' }],
    });
    expect(proposal.proposedDiff).toEqual([{ state: 'selector', control: 'button "Download"', expected: '1', observed: 0 }]);
    expect(proposal.facts.some((fact) => fact.includes('observed 0'))).toBe(true);
    expect(proposal.hypotheses.length).toBeGreaterThan(0);
    expect(proposal.facts.some((fact) => fact.includes('stopped before expect-download'))).toBe(true);
  });
});
