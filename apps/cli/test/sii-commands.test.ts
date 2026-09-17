import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import type { KeyValueStore, PortalDriver, PortalSession, Runtime } from '../../../services/sii/src/seams/index.js';

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

/** A tiny but well-formed PDF with one text object, so pdftotext can read it in tests. */
function minimalPdf(text: string): Uint8Array {
  const escaped = text.replace(/[\\()]/gu, (c) => `\\${c}`);
  const stream = `BT /F1 12 Tf 40 700 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${String(Buffer.byteLength(stream, 'latin1'))} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body, 'latin1')); body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, 'latin1'));
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

  it('rejects --rut: --empresa is the only entity-selection option', async () => {
    const h = harness(fakeRuntime(memoryStore()));
    expect(await runCli(['sii', 'rcv', 'all', '2026-08', '--rut', '20000042-0'], h.deps)).toBe(2);
    expect(h.error()).toMatchObject({ code: 'INVALID_INPUT', validation: [{ field: '--rut' }] });
    expect(h.lines().some((l) => l.notice !== undefined)).toBe(false);
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

  it('lists and downloads received documents through the observed MIPYME route with text validation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'portales-sii-received-'));
    await chmod(directory, 0o700);
    const staging = join(directory, 'staging');
    await mkdir(staging, { mode: 0o700 });
    const chooser = '<html><select name="RUT_EMP"><option value="20000042-0">Synthetic Empresa 20000042-0</option></select></html>';
    const row = (codigo: string, emisor: string, folio: string) => `<tr><td><a href="/cgi-bin/Portal001/mipeGesDocRcp.cgi?CODIGO=${codigo}&amp;ALL_PAGE_ANT=1"><img></a></td><td>${emisor}</td><td>SYNTHETIC EMISOR</td><td>Factura Electronica</td><td>${folio}</td><td>2026-08-02</td><td>1190</td><td>DTE Recibido Sin Reparos</td></tr>`;
    const listing = (url: string) => {
      const folio = new URL(url).searchParams.get('FOLIO');
      const rows = [row('900000000001', '76000001-9', '7'), row('900000000002', '76000002-7', '7'), row('900000000003', '76000001-9', '8')]
        .filter((r) => folio === '' || folio === null || r.includes(`<td>${folio}</td>`));
      const emisor = new URL(url).searchParams.get('RUT_EMI');
      return `<html><table>${rows.filter((r) => !emisor || r.includes(`<td>${emisor}-`)).join('')}</table></html>`;
    };
    const requests: string[] = [];
    const session = {
      goto: (url: string) => { requests.push(`GOTO ${url}`); return Promise.resolve(url); },
      evaluate: () => Promise.resolve(null),
      requestJson: () => Promise.reject(new Error('not used')),
      requestForm: (url: string, options?: { form?: Record<string, string> }) => {
        requests.push(`FORM ${url.split('?')[0] ?? ''} ${options?.form ? 'POST' : 'GET'}`);
        if (url.includes('mipeSelEmpresa.cgi')) return Promise.resolve({ status: 200, body: options?.form ? '<html>form landed</html>' : chooser });
        if (url.includes('mipeAdminDocsRcp.cgi')) return Promise.resolve({ status: 200, body: listing(url) });
        return Promise.reject(new Error(`unexpected form url ${url}`));
      },
      requestText: () => Promise.reject(new Error('not used')),
      requestBinary: (url: string) => {
        requests.push(`BINARY ${url.split('?')[0] ?? ''} ${new URL(url).searchParams.get('CODIGO') ?? ''}`);
        return Promise.resolve({ status: 200, contentType: 'application/pdf', bytes: minimalPdf('Nº 7   R.U.T.: 76.000.001-9   R.U.T.: 20.000.042-0') });
      },
      cookie: () => Promise.resolve(null),
      storageState: () => Promise.resolve({}),
      close: () => Promise.resolve(),
    } as unknown as PortalSession;
    const files = { write: async (_dir: string, name: string, bytes: Uint8Array) => { const path = join(staging, name); await writeFile(path, bytes, { mode: 0o600 }); return path; } };
    const runtime = { ...fakeRuntime(memoryStore({ session: SESSION, operate: SELF }), { restore: () => Promise.resolve(session) }), files };
    try {
      const l = harness(runtime);
      expect(await runCli(['sii', 'dte', 'documentos', 'list', '--empresa', '20000042-0', '--direction', 'received'], l.deps)).toBe(0);
      expect(l.result()).toMatchObject({ direction: 'received', source: 'mipyme-recibidos', documentos: [{ codigo: '900000000001', emisorRut: '76000001-9', folio: 7 }, { codigo: '900000000002' }, { codigo: '900000000003', folio: 8 }] });
      const ambiguous = harness(runtime);
      expect(await runCli(['sii', 'dte', 'documentos', 'download', '--empresa', '20000042-0', '--direction', 'received', '--folio', '7', '--output', directory], ambiguous.deps)).toBe(2);
      expect(String(ambiguous.error()?.message)).toContain('--emisor');
      const missing = harness(runtime);
      expect(await runCli(['sii', 'dte', 'documentos', 'download', '--empresa', '20000042-0', '--direction', 'received', '--folio', '99', '--output', directory], missing.deps)).toBe(7);
      expect(missing.error()).toMatchObject({ code: 'CONTRACT_MISMATCH' });
      expect(requests.filter((r) => r.startsWith('BINARY'))).toEqual([]);
      const d = harness(runtime);
      expect(await runCli(['sii', 'dte', 'documentos', 'download', '--empresa', '20000042-0', '--direction', 'received', '--folio', '7', '--emisor', '76000001-9', '--output', directory], d.deps)).toBe(0);
      expect(requests.filter((r) => r.startsWith('BINARY'))).toEqual(['BINARY https://www1.sii.cl/cgi-bin/Portal001/mipeShowPdf.cgi 900000000001']);
      expect(d.result()).toMatchObject({ documentType: 'dte-received-pdf', mediaType: 'application/pdf', identifiers: { empresa: '20000042-0', emisor: '76000001-9', folio: '7' }, validationChecks: ['private-permissions', 'signature', 'folio-in-text', 'ruts-in-text'], destination: 'output', documento: { codigo: '900000000001' } });
      expect(String(d.result().path)).toContain(directory);
      expect(String(d.result().artifactId)).toMatch(/^art_/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
