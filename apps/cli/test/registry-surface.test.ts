import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { buildRegistry } from '../src/registry.js';
import { listRunRecords } from '../../../packages/runtime/src/runs.js';
import { stateRoot } from '../../../packages/runtime/src/paths.js';

function harness() {
  const out: string[] = [];
  const err: string[] = [];
  const deps = { openSessionPortal: vi.fn(), login: vi.fn(), stdout: (v: string) => { out.push(v); }, stderr: (v: string) => { err.push(v); } };
  return { out, err, deps, json: () => JSON.parse(out.join('')) as Record<string, unknown>, error: () => err.map((l) => JSON.parse(l) as { error?: Record<string, unknown> }).find((l) => l.error)?.error };
}

describe('agent-facing surface', () => {
  it('renders hierarchical help without a profile or portal contact', async () => {
    for (const args of [['--help'], ['bci-pyme', '--help'], ['bci-pyme', 'cartolas', '--help'], ['sii', 'dte', 'borrador', '--help'], ['runs', '--help']]) {
      const h = harness();
      expect(await runCli(args, h.deps)).toBe(0);
      expect(h.out.join('')).toContain('portales');
      expect(h.deps.openSessionPortal).not.toHaveBeenCalled();
    }
  });

  it('generates catalog and describe from the registry and rejects unknown operations actionably', async () => {
    const h = harness();
    expect(await runCli(['catalog', '--json'], h.deps)).toBe(0);
    const catalog = h.json();
    expect(catalog).toMatchObject({ schemaVersion: '1', service: 'portales', operation: 'catalog' });
    const registry = buildRegistry();
    const result = catalog.result as { services: { slug: string; commands: unknown[] }[]; globals: unknown[] };
    expect(result.services.map((s) => s.slug)).toEqual(registry.services.map((s) => s.slug));
    expect(result.services.reduce((n, s) => n + s.commands.length, 0)).toBe(registry.services.reduce((n, s) => n + s.commands.length, 0));
    const d = harness();
    expect(await runCli(['describe', 'bci-pyme', 'cartolas', 'download', '--json'], d.deps)).toBe(0);
    expect(d.json().result).toMatchObject({ operation: 'cartolas.download', effect: 'read', auth: 'session', browser: 'headed', });
    expect((d.json().result as { contractRef: string }).contractRef).toContain('read-only-browser-flow.md');
    const u = harness();
    expect(await runCli(['describe', 'bci-pyme', 'nope'], u.deps)).toBe(2);
    expect(u.error()).toMatchObject({ code: 'INVALID_INPUT', nextCommand: 'portales catalog --json' });
  });

  it('returns actionable validation errors naming the field and discovery command', async () => {
    const h = harness();
    expect(await runCli(['bci-pyme', 'accounts', 'options', '--profile', 'testing'], h.deps)).toBe(2);
    expect(h.error()).toMatchObject({
      code: 'INVALID_INPUT', safeToRetry: true, remoteMutationPossible: false,
      nextCommand: 'portales bci-pyme businesses list --profile testing',
      validation: [{ field: '--business-id', discoverWith: 'portales bci-pyme businesses list --profile testing' }],
    });
    const e = harness();
    expect(await runCli(['sag', 'declaracion-jurada', 'options', 'bogus'], e.deps)).toBe(2);
    expect((e.error() as { validation: { field: string; expected: string }[] }).validation[0]).toMatchObject({ field: '<field>' });
    expect((e.error() as { validation: { expected: string }[] }).validation[0]?.expected).toContain('nationality');
    expect(h.deps.openSessionPortal).not.toHaveBeenCalled();
  });

  it('emits lifecycle events and a private run record sharing one runId, and serializes runs per profile', async () => {
    let release = () => { /* set below */ };
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const portal = { requireAuthenticatedSession: vi.fn().mockResolvedValue(undefined), discoverBusinesses: vi.fn(async () => { await blocked; return []; }), close: vi.fn() };
    const h = harness();
    h.deps.openSessionPortal.mockResolvedValue(portal);
    const first = runCli(['bci-pyme', 'businesses', 'list', '--profile', 'testing'], h.deps);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = harness();
    second.deps.openSessionPortal.mockResolvedValue(portal);
    expect(await runCli(['bci-pyme', 'businesses', 'list', '--profile', 'testing'], second.deps)).toBe(10);
    expect(second.error()).toMatchObject({ code: 'RUN_LOCKED' });
    expect((second.error() as { activeRunId: string }).activeRunId).toMatch(/^run_/u);
    release();
    expect(await first).toBe(0);
    const runId = (h.json() as { runId: string }).runId;
    const stages = h.err.map((l) => JSON.parse(l) as { runId: string; stage?: string }).filter((l) => l.stage !== undefined);
    expect(stages.map((s) => s.stage)).toEqual(['preflight', 'session-check', 'navigate', 'parse', 'completed']);
    expect(new Set(stages.map((s) => s.runId))).toEqual(new Set([runId]));
    const records = await listRunRecords({ service: 'bci-pyme' }, stateRoot());
    const record = records.find((r) => r.runId === runId);
    expect(record).toMatchObject({ status: 'completed', exitCode: 0, profile: 'testing', operation: 'businesses.list' });
    expect(JSON.stringify(record)).not.toContain('cookie');
    const show = harness();
    expect(await runCli(['runs', 'show', runId], show.deps)).toBe(0);
    expect(show.json().result).toMatchObject({ runId, status: 'completed' });
  });
});
