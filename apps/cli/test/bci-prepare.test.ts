import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function harness() {
  const out: string[] = [];
  const err: string[] = [];
  const deps = { openSessionPortal: vi.fn(), login: vi.fn(), stdout: (v: string) => { out.push(v); }, stderr: (v: string) => { err.push(v); } };
  return {
    out, err, deps,
    result: () => (JSON.parse(out.join('')) as { result: Record<string, unknown> }).result,
    error: () => err.map((l) => JSON.parse(l) as { error?: Record<string, unknown> }).find((l) => l.error)?.error,
  };
}

function syntheticPortal(directory: string) {
  const accounts: Record<string, { id: string; label: string }[]> = {
    'business-synthetic-a': [{ id: 'account-synthetic-a1', label: 'Cuenta Corriente Uno' }, { id: 'account-synthetic-a2', label: 'Cuenta Corriente Dos' }],
    'business-synthetic-b': [{ id: 'account-synthetic-b1', label: 'Cuenta Corriente Uno' }],
  };
  return {
    accounts,
    businesses: [{ id: 'business-synthetic-a', label: 'Empresa Sintética Alfa' }, { id: 'business-synthetic-b', label: 'Empresa Sintética Beta' }],
    requireAuthenticatedSession: vi.fn().mockResolvedValue(undefined),
    discoverBusinesses: vi.fn(function (this: { businesses: unknown }) { return Promise.resolve(this.businesses); }),
    discoverAccounts: vi.fn((businessId: string) => Promise.resolve(accounts[businessId] ?? [])),
    downloadCartola: vi.fn(async () => {
      const path = join(directory, `cartola-${String(Math.random()).slice(2)}.xlsx`);
      await writeFile(path, 'synthetic-bytes', { mode: 0o600 });
      return { path, mediaType: XLSX, byteCount: 15, sha256: 'c'.repeat(64) };
    }),
    close: vi.fn(),
  };
}

describe('cartolas prepare and snapshot download', () => {
  it('resolves labels once, stores a private snapshot, and downloads from it without rediscovering accounts twice', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'portales-synthetic-prepare-'));
    const portal = syntheticPortal(directory);
    const p = harness();
    p.deps.openSessionPortal.mockResolvedValue(portal);
    expect(await runCli(['bci-pyme', 'cartolas', 'prepare', '--profile', 'testing', '--business', 'empresa sintetica alfa', '--account', 'account-synthetic-a2'], p.deps)).toBe(0);
    const prepared = p.result() as { snapshotId: string; fingerprint: string; selections: unknown[]; nextCommand: string; expiresAt: string };
    expect(prepared.snapshotId).toMatch(/^snap_/u);
    expect(prepared.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(prepared.selections).toEqual([{ businessId: 'business-synthetic-a', accountId: 'account-synthetic-a2', documentType: 'excel-detallado' }]);
    expect(prepared.nextCommand).toContain(prepared.snapshotId);
    expect(portal.discoverAccounts).toHaveBeenCalledTimes(1);
    const snapshotPath = join(process.env.XDG_STATE_HOME as string, 'portales', 'bci-pyme', 'snapshots', 'testing', `${prepared.snapshotId}.json`);
    expect(await readFile(snapshotPath, 'utf8')).not.toContain('cookie');

    const d = harness();
    d.deps.openSessionPortal.mockResolvedValue(portal);
    portal.discoverAccounts.mockClear();
    expect(await runCli(['bci-pyme', 'cartolas', 'download', '--profile', 'testing', '--snapshot', prepared.snapshotId], d.deps)).toBe(0);
    const { downloads, snapshotId } = d.result() as { downloads: Record<string, unknown>[]; snapshotId: string };
    expect(snapshotId).toBe(prepared.snapshotId);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatchObject({ businessId: 'business-synthetic-a', accountId: 'account-synthetic-a2', documentType: 'excel-detallado', byteCount: 15, sha256: 'c'.repeat(64), mediaType: XLSX, destinationSource: 'default', coveredPeriod: null, service: 'bci-pyme', profile: 'testing' });
    expect(downloads[0]?.artifactId).toMatch(/^art_/u);
    expect(portal.discoverAccounts).toHaveBeenCalledTimes(1);
    expect(portal.downloadCartola).toHaveBeenCalledOnce();
    expect(d.deps.login).not.toHaveBeenCalled();
  });

  it('rejects ambiguous labels with the candidate list and no download', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'portales-synthetic-ambiguous-'));
    const portal = syntheticPortal(directory);
    const h = harness();
    h.deps.openSessionPortal.mockResolvedValue(portal);
    expect(await runCli(['bci-pyme', 'cartolas', 'prepare', '--profile', 'testing', '--business', 'Empresa Sintética', '--account', 'Cuenta Corriente Uno'], h.deps)).toBe(2);
    expect(h.error()).toMatchObject({ code: 'INVALID_INPUT', nextCommand: 'portales bci-pyme businesses list --profile testing' });
    expect(JSON.stringify(h.error())).toContain('business-synthetic-a');
    expect(portal.downloadCartola).not.toHaveBeenCalled();
  });

  it('rejects an expired snapshot and a stale snapshot with the smallest option diff', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'portales-synthetic-stale-'));
    const portal = syntheticPortal(directory);
    const p = harness();
    p.deps.openSessionPortal.mockResolvedValue(portal);
    expect(await runCli(['bci-pyme', 'cartolas', 'prepare', '--profile', 'testing', '--business', 'business-synthetic-b', '--account', 'account-synthetic-b1'], p.deps)).toBe(0);
    const { snapshotId } = p.result() as { snapshotId: string };
    const snapshotPath = join(process.env.XDG_STATE_HOME as string, 'portales', 'bci-pyme', 'snapshots', 'testing', `${snapshotId}.json`);

    portal.accounts['business-synthetic-b'] = [{ id: 'account-synthetic-b1', label: 'Cuenta Corriente Uno' }, { id: 'account-synthetic-b9', label: 'Cuenta Nueva' }];
    const stale = harness();
    stale.deps.openSessionPortal.mockResolvedValue(portal);
    expect(await runCli(['bci-pyme', 'cartolas', 'download', '--profile', 'testing', '--snapshot', snapshotId], stale.deps)).toBe(2);
    expect(stale.error()).toMatchObject({ code: 'SNAPSHOT_STALE', safeToRetry: true });
    expect(String(stale.error()?.message)).toContain('account-synthetic-b9');
    expect(portal.downloadCartola).not.toHaveBeenCalled();

    const record = JSON.parse(await readFile(snapshotPath, 'utf8')) as { expiresAt: string };
    record.expiresAt = new Date(Date.now() - 1000).toISOString();
    await writeFile(snapshotPath, JSON.stringify(record), { mode: 0o600 });
    const expired = harness();
    expired.deps.openSessionPortal.mockResolvedValue(portal);
    expect(await runCli(['bci-pyme', 'cartolas', 'download', '--profile', 'testing', '--snapshot', snapshotId], expired.deps)).toBe(2);
    expect(expired.error()).toMatchObject({ code: 'SNAPSHOT_EXPIRED' });
    expect(expired.deps.openSessionPortal).not.toHaveBeenCalled();

    const other = harness();
    other.deps.openSessionPortal.mockResolvedValue(portal);
    expect(await runCli(['bci-pyme', 'cartolas', 'download', '--profile', 'other', '--snapshot', snapshotId], other.deps)).toBe(2);
    expect(other.error()).toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('places verified files in an explicit private --output and refuses unsafe directories', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'portales-synthetic-output-'));
    const portal = syntheticPortal(directory);
    const target = join(directory, 'org-private');
    await mkdir(target, { mode: 0o700 });
    await chmod(target, 0o700);
    const ok = harness();
    ok.deps.openSessionPortal.mockResolvedValue(portal);
    expect(await runCli(['bci-pyme', 'cartolas', 'download', '--profile', 'testing', '--business-id', 'business-synthetic-a', '--account-id', 'account-synthetic-a1', '--output', target], ok.deps)).toBe(0);
    const { downloads } = ok.result() as { downloads: { path: string; destinationSource: string }[] };
    expect(downloads[0]?.destinationSource).toBe('output');
    expect(downloads[0]?.path.startsWith(target)).toBe(true);

    const loose = join(directory, 'loose');
    await mkdir(loose, { mode: 0o755 });
    await chmod(loose, 0o755);
    const bad = harness();
    bad.deps.openSessionPortal.mockResolvedValue(portal);
    expect(await runCli(['bci-pyme', 'cartolas', 'download', '--profile', 'testing', '--business-id', 'business-synthetic-a', '--account-id', 'account-synthetic-a1', '--output', loose], bad.deps)).toBe(2);
    expect(bad.error()).toMatchObject({ code: 'INVALID_INPUT', validation: [{ field: '--output' }] });
    const both = harness();
    expect(await runCli(['bci-pyme', 'cartolas', 'download', '--profile', 'testing', '--snapshot', 'snap_00000000000000_00000000', '--input', '/x'], both.deps)).toBe(2);
    expect(both.deps.openSessionPortal).not.toHaveBeenCalled();
  });

  it('returns the business/account tree from one session and local auth status without a browser', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'portales-synthetic-tree-'));
    const portal = syntheticPortal(directory);
    const t = harness();
    t.deps.openSessionPortal.mockResolvedValue(portal);
    expect(await runCli(['bci-pyme', 'businesses', 'options', '--profile', 'testing', '--tree'], t.deps)).toBe(0);
    const tree = t.result() as { field: string; source: string; contractVersion: string; options: { id: string; accounts: { options: unknown[] } }[] };
    expect(tree).toMatchObject({ field: 'business-id', source: 'live', contractVersion: '2026-09-17' });
    expect(tree.options.map((b) => [b.id, b.accounts.options.length])).toEqual([['business-synthetic-a', 2], ['business-synthetic-b', 1]]);
    expect(t.deps.openSessionPortal).toHaveBeenCalledOnce();

    const s = harness();
    expect(await runCli(['bci-pyme', 'auth', 'status', '--profile', 'testing'], s.deps)).toBe(0);
    expect(s.result()).toMatchObject({ profile: 'testing', sessionPresent: false, breaker: { tripped: false }, newLoginPermitted: true, liveness: 'unknown-local-only', lastAuthenticatedStage: null });
    expect(s.deps.openSessionPortal).not.toHaveBeenCalled();
    expect(s.deps.login).not.toHaveBeenCalled();
    const b = harness();
    expect(await runCli(['bci-pyme', 'auth', 'breaker', 'status', '--profile', 'testing'], b.deps)).toBe(0);
    expect(b.result()).toMatchObject({ tripped: false, newLoginPermitted: true, resetRequires: 'human-review' });
    const l = harness();
    expect(await runCli(['bci-pyme', 'auth', 'logout', '--profile', 'testing'], l.deps)).toBe(0);
    expect(l.result()).toMatchObject({ localSessionRemoved: false, remoteRevoked: false });
  });
});
