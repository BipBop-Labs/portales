import { describe, expect, it, vi } from 'vitest';
import { runDoctor, type DoctorProbes } from '../src/doctor.js';

function probes(overrides: Partial<DoctorProbes> = {}): DoctorProbes {
  return {
    env: { PATH: '/synthetic/bin' },
    roots: { state: '/synthetic/state', data: '/synthetic/data', config: '/synthetic/config' },
    now: () => new Date('2026-09-17T12:00:00Z'),
    version: vi.fn().mockResolvedValue({ packageVersion: '0.1.0', commit: 'abc', builtAt: null, builtCommit: null, sourceCheckout: '/synthetic', distPath: '/synthetic/dist', stale: false, staleReasons: [], node: 'v26.0.0' }),
    onPath: vi.fn().mockResolvedValue(true),
    chromiumExecutable: vi.fn().mockResolvedValue('/synthetic/chromium'),
    secretService: vi.fn().mockResolvedValue('reachable'),
    bciSession: vi.fn().mockResolvedValue({ present: true, earliestExpiry: '2026-12-01T00:00:00Z' }),
    siiSession: vi.fn().mockResolvedValue({ present: true, www2ExpiresAt: null }),
    breaker: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe('doctor', () => {
  it('warns on a stale build and points to the update command', async () => {
    const report = await runDoctor({ profile: 'testing' }, probes({
      version: vi.fn().mockResolvedValue({ packageVersion: '0.1.0', commit: 'abc', builtAt: '2026-09-17T00:00:00Z', builtCommit: 'old', sourceCheckout: '/s', distPath: '/s/dist', stale: true, staleReasons: ['commit-differs-from-build'], node: 'v26.0.0' }),
    }));
    expect(report.checks.find((check) => check.name === 'build')).toMatchObject({ status: 'warn', nextAction: 'npm run update' });
    expect(report.status).toBe('warn');
    expect(report.live).toBe(false);
  });

  it('fails on a missing xvfb-run only for bci-pyme', async () => {
    const onPath = vi.fn((binary: string) => Promise.resolve(binary !== 'xvfb-run'));
    const bci = await runDoctor({ service: 'bci-pyme', profile: 'testing' }, probes({ onPath }));
    expect(bci.checks.find((check) => check.name === 'bci-pyme:xvfb-run')).toMatchObject({ status: 'fail' });
    expect(bci.status).toBe('fail');
    const sii = await runDoctor({ service: 'sii', profile: 'testing' }, probes({ onPath }));
    expect(sii.checks.some((check) => check.name.includes('xvfb'))).toBe(false);
    expect(sii.status).toBe('ok');
  });

  it('fails with an actionable next step when the Secret Service is not reachable, without any portal call', async () => {
    const secretService = vi.fn().mockResolvedValue('unavailable' as const);
    const report = await runDoctor({ service: 'sii', profile: 'testing' }, probes({ secretService }));
    expect(report.checks.find((check) => check.name === 'keyring')).toMatchObject({ status: 'fail', nextAction: expect.stringContaining('Secret Service provider') as string });
    expect(JSON.stringify(report)).not.toMatch(/cookie|clave|password/iu);
    const sag = await runDoctor({ service: 'sag', profile: 'testing' }, probes({ secretService }));
    expect(secretService).toHaveBeenCalledOnce();
    expect(sag.checks.some((check) => check.name === 'keyring')).toBe(false);
  });
});
