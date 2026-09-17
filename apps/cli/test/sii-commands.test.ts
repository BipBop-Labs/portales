import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import type { KeyValueStore, PortalDriver, Runtime } from '../../../services/sii/src/seams/index.js';

function memoryStore(initial: Record<string, unknown> = {}): KeyValueStore {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    read: <T>(key: string) => Promise.resolve((data.get(key) as T | undefined) ?? null),
    write: (key, value) => { data.set(key, value); return Promise.resolve(); },
    delete: (key) => { data.delete(key); return Promise.resolve(); },
  };
}

function fakeRuntime(store: KeyValueStore, portal: Partial<PortalDriver> = {}): Runtime {
  const refuse = () => Promise.reject(new Error('portal driver must not be called'));
  return {
    clock: { now: () => new Date('2026-09-17T12:00:00Z'), sleep: () => Promise.resolve() },
    audit: { record: () => undefined },
    store,
    portal: { interactiveLogin: refuse, credentialLogin: refuse, restore: refuse, requestPublic: refuse, ...portal },
  };
}

function harness(runtime: Runtime) {
  const out: string[] = [];
  const err: string[] = [];
  const deps = {
    openSessionPortal: vi.fn(), login: vi.fn(), createSiiRuntime: () => runtime,
    stdout: (v: string) => { out.push(v); }, stderr: (v: string) => { err.push(v); },
  };
  const lines = () => err.map((l) => JSON.parse(l) as Record<string, unknown>);
  return { out, err, deps, result: () => (JSON.parse(out.join('')) as { result: Record<string, unknown> }).result, error: () => lines().find((l) => l.error !== undefined)?.error as Record<string, unknown> | undefined, lines };
}

const SESSION = { rut: '20000042-0', cookies: {}, savedAt: '2026-09-17T11:00:00Z' };
const SELF = { selfRut: '20000042-0', accountType: 'persona', operatingRut: '20000042-0', operable: [{ rut: '20000042-0', razonSocial: 'Synthetic', isSelf: true }] };

describe('SII registry commands', () => {
  it('maps a missing session to NOT_AUTHENTICATED with the login command as nextCommand', async () => {
    const h = harness(fakeRuntime(memoryStore()));
    expect(await runCli(['sii', 'rcv', 'summary', '2026-08', '--profile', 'testing'], h.deps)).toBe(3);
    expect(h.error()).toMatchObject({ code: 'NOT_AUTHENTICATED', nextCommand: 'portales sii auth login --profile testing', contractRef: 'docs/SII.md#rcv-purchases-and-sales', stage: 'session-check' });
    expect(h.out).toEqual([]);
  });

  it('accepts --rut as a deprecated alias of --empresa and announces it on STDERR', async () => {
    const h = harness(fakeRuntime(memoryStore()));
    await runCli(['sii', 'rcv', 'all', '2026-08', '--rut', '20000042-0'], h.deps);
    expect(h.lines()).toContainEqual(expect.objectContaining({ notice: 'deprecated-option', option: '--rut', replacement: '--empresa', service: 'sii' }));
  });

  it('reports auth status locally without touching the portal driver, including breaker state', async () => {
    const h = harness(fakeRuntime(memoryStore({ session: SESSION })));
    expect(await runCli(['sii', 'auth', 'status', '--profile', 'testing'], h.deps)).toBe(0);
    expect(h.result()).toMatchObject({ authenticated: true, rut: '20000042-0', sessionSource: 'cached', newLoginPermitted: true, breaker: { tripped: false }, lastAuthenticatedStage: 'session-persisted' });
    const b = harness(fakeRuntime(memoryStore()));
    expect(await runCli(['sii', 'auth', 'breaker', 'status', '--profile', 'testing'], b.deps)).toBe(0);
    expect(b.result()).toMatchObject({ tripped: false, newLoginPermitted: true });
  });

  it('rejects principal-only BTE reads under a representing operate pointer and names the scope', async () => {
    const h = harness(fakeRuntime(memoryStore({ session: SESSION, operate: { ...SELF, operatingRut: '76000001-3' } })));
    expect(await runCli(['sii', 'bte', 'list', '2026-08'], h.deps)).toBe(2);
    expect(h.error()).toMatchObject({ code: 'INVALID_INPUT', validation: [{ field: 'scope', expected: 'the authenticated principal (supportedScopes: principal)' }] });
  });

  it('returns a typed capability response for received-document downloads', async () => {
    const h = harness(fakeRuntime(memoryStore({ session: SESSION, operate: SELF })));
    expect(await runCli(['sii', 'dte', 'documentos', 'download', '--empresa', '20000042-0', '--direction', 'received', '--folio', '7'], h.deps)).toBe(2);
    expect(h.error()).toMatchObject({ code: 'UNSUPPORTED_CAPABILITY', contractRef: 'docs/SII.md#dte-documents' });
    expect(String(h.error()?.nextCommand)).toContain('--direction received');
    const l = harness(fakeRuntime(memoryStore({ session: SESSION, operate: SELF })));
    expect(await runCli(['sii', 'dte', 'documentos', 'list', '--empresa', '20000042-0', '--direction', 'received'], l.deps)).toBe(2);
    expect(l.error()).toMatchObject({ code: 'INVALID_INPUT', validation: [{ field: '--periodo' }] });
  });

  it('lists comunas locally and keeps every SII command registry-parsed', async () => {
    const h = harness(fakeRuntime(memoryStore()));
    expect(await runCli(['sii', 'bte', 'comunas', '--region', '13'], h.deps)).toBe(0);
    expect(Object.keys(h.result()).length).toBeGreaterThan(0);
    const c = harness(fakeRuntime(memoryStore()));
    expect(await runCli(['catalog', '--json'], c.deps)).toBe(0);
    const sii = (c.result() as { services: { slug: string; commands: { legacyParsing: boolean; operation: string }[] }[] }).services.find((s) => s.slug === 'sii');
    expect(sii?.commands.every((cmd) => !cmd.legacyParsing)).toBe(true);
    expect(sii?.commands.map((cmd) => cmd.operation)).toEqual(expect.arrayContaining(['auth.setup', 'auth.status', 'auth.logout', 'auth.breaker.status', 'dte.documentos.list', 'dte.documentos.download']));
  });
});
