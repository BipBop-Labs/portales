import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { stateRoot } from '../../../packages/runtime/src/paths.js';
import { writeRunRecord } from '../../../packages/runtime/src/runs.js';
import { writeObservationBundle } from '../../../packages/runtime/src/observation.js';

function harness() {
  const out: string[] = [];
  const err: string[] = [];
  const deps = { openSessionPortal: vi.fn(), login: vi.fn(), stdout: (v: string) => { out.push(v); }, stderr: (v: string) => { err.push(v); } };
  return { out, err, deps, json: () => JSON.parse(out.join('')) as { result: Record<string, unknown> } };
}

describe('contract check and verify', () => {
  it('validates the checked-in contracts through the public CLI', async () => {
    const h = harness();
    expect(await runCli(['contract', 'validate', '--json'], h.deps)).toBe(0);
    expect((h.json().result.contracts as unknown[]).length).toBeGreaterThanOrEqual(6);
  });

  it('writes a sanitized scaffold outside the repository from a synthetic run record and observation', async () => {
    const runId = 'run_20260101000000_0badcafe';
    await writeRunRecord({ schemaVersion: '1', runId, service: 'bci-pyme', operation: 'businesses.list', profile: 'testing', effect: 'read', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:01Z', status: 'failed', exitCode: 7, browserMode: 'headed-xvfb', contractVersion: '2026-09-14', packageVersion: '0.1.0', commit: null, stages: [{ stage: 'preflight', at: '2026-01-01T00:00:00Z', elapsedMs: 0 }], error: { code: 'CONTRACT_MISMATCH', recovery: { stage: 'navigate' } }, artifacts: [] }, stateRoot());
    await writeObservationBundle({ schemaVersion: '1', runId, service: 'bci-pyme', operation: 'businesses.list', observedAt: '2026-01-01T00:00:00Z', browserMode: 'headed-xvfb', responseFingerprints: {}, stoppedBefore: null, states: [{ expectedState: 'business-selector', classification: { kind: 'changed', state: 'business-selector', diff: ['x'] }, routeFragment: '/seguridad/autenticacion/vista/vistaSelectorConvenio.jsf', frameNames: [], controls: [{ control: "css tr:has(a[id*='linkConvenio'])", visibleCount: 0 }], readinessMarkers: [], ariaSnapshot: '- text: <text>' }] }, { schemaVersion: '1', runId, contractPath: 'x.json', facts: ['synthetic fact'], hypotheses: ['synthetic hypothesis'], proposedDiff: [{ state: 'business-selector', control: "css tr:has(a[id*='linkConvenio'])", expected: 'at least 1', observed: 0 }] }, stateRoot());
    const h = harness();
    expect(await runCli(['contract', 'check', runId], h.deps)).toBe(0);
    const result = h.json().result as { scaffold: string; proposedDiffCount: number; contractPath: string | null };
    expect(result.proposedDiffCount).toBe(1);
    expect(result.contractPath).toContain('read-only-browser-flow.json');
    expect(result.scaffold.startsWith(stateRoot())).toBe(true);
    const scaffold = await readFile(result.scaffold, 'utf8');
    expect(scaffold).toContain('synthetic fact');
    expect(scaffold).toContain('## Hypotheses (unverified)');
    expect(scaffold).toContain('| business-selector |');
    const missing = harness();
    expect(await runCli(['contract', 'check', 'run_20260101000000_deadbeef'], missing.deps)).toBe(2);
  });

  it('never reports live verification without --live', async () => {
    const h = harness();
    expect(await runCli(['bci-pyme', 'verify', '--profile', 'testing'], h.deps)).toBe(0);
    expect(h.json().result).toMatchObject({ live: false, verified: [] });
    expect(h.deps.openSessionPortal).not.toHaveBeenCalled();
    const live = harness();
    const portal = { requireAuthenticatedSession: vi.fn().mockResolvedValue(undefined), discoverBusinesses: vi.fn().mockResolvedValue([{ id: 'synthetic-business', label: 'Synthetic' }]), discoverAccounts: vi.fn().mockResolvedValue([{ id: '1234567', label: 'Cuenta 1234567' }]), close: vi.fn() };
    live.deps.openSessionPortal.mockResolvedValue(portal);
    expect(await runCli(['bci-pyme', 'verify', '--profile', 'testing', '--live'], live.deps)).toBe(0);
    expect(live.json().result).toMatchObject({ live: true, verified: [{ operation: 'businesses.list' }, { operation: 'accounts.options' }] });
    expect(portal.close).toHaveBeenCalledOnce();
  });

  it('refuses observation on a portal without observe support and never logs in', async () => {
    const h = harness();
    const portal = { requireAuthenticatedSession: vi.fn().mockResolvedValue(undefined), close: vi.fn() };
    h.deps.openSessionPortal.mockResolvedValue(portal);
    expect(await runCli(['bci-pyme', 'observe', 'businesses.list', '--profile', 'testing'], h.deps)).toBe(2);
    expect(h.deps.login).not.toHaveBeenCalled();
    expect(portal.close).toHaveBeenCalledOnce();
    const bad = harness();
    expect(await runCli(['bci-pyme', 'observe', 'destinatarios.create', '--profile', 'testing'], bad.deps)).toBe(2);
    expect(bad.deps.openSessionPortal).not.toHaveBeenCalled();
  });
});
