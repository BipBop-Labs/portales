import { execFile } from 'node:child_process';
import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { browserModeFor, type BrowserMode, type BrowserRequirement } from './browser-mode.js';
import { destinationsConfigPath } from './destinations.js';
import { configRoot, dataRoot, stateRoot } from './paths.js';
import { readServiceLock } from './runs.js';
import { readVersionInfo, type VersionInfo } from './version.js';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skipped';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  /** Static text; never portal data, secrets, or cookie values. */
  detail: string;
  nextAction?: string;
}

export interface DoctorReport {
  service: string | null;
  profile: string;
  status: CheckStatus;
  browserMode: BrowserMode;
  live: false;
  checks: DoctorCheck[];
}

export type SecretServiceProbe = 'reachable' | 'not-found' | 'unavailable';

/** Local-only probes. Every default touches the local machine and never a portal. */
export interface DoctorProbes {
  version(): Promise<VersionInfo>;
  onPath(binary: string): Promise<boolean>;
  chromiumExecutable(): Promise<string | null>;
  secretService(): Promise<SecretServiceProbe>;
  /** Earliest ISO expiry among stored BCI cookies, `'none'` when no session file exists. */
  bciSession(profile: string): Promise<{ present: boolean; earliestExpiry: string | null }>;
  siiSession(profile: string): Promise<{ present: boolean; www2ExpiresAt: string | null } | 'unavailable'>;
  breaker(service: string, profile: string): Promise<boolean | 'unsupported'>;
  env: NodeJS.ProcessEnv;
  roots: { state: string; data: string; config: string };
  now(): Date;
}

const execute = promisify(execFile);

export function defaultProbes(env: NodeJS.ProcessEnv = process.env): DoctorProbes {
  const roots = { state: stateRoot(env), data: dataRoot(env), config: configRoot(env) };
  return {
    env,
    roots,
    now: () => new Date(),
    version: () => readVersionInfo(),
    async onPath(binary) {
      const directories = (env.PATH ?? '').split(':').filter((item) => item !== '');
      for (const directory of directories) {
        if (await access(join(directory, binary), constants.X_OK).then(() => true, () => false)) return true;
      }
      return false;
    },
    async chromiumExecutable() {
      try {
        const { chromium } = await import('playwright');
        const path = chromium.executablePath();
        return await access(path, constants.X_OK).then(() => path, () => null);
      } catch {
        return null;
      }
    },
    async secretService() {
      try {
        await execute('secret-tool', ['lookup', 'service', 'cl.bipbop.portales.__probe__', 'account', '__probe__'], { timeout: 5_000, env });
        return 'reachable';
      } catch (error: unknown) {
        const item = error as { code?: unknown; stderr?: unknown };
        if (item.code === 'ENOENT') return 'not-found';
        const text = typeof item.stderr === 'string' ? item.stderr : '';
        // secret-tool exits 1 for "no item" with empty stderr; anything with a message is a D-Bus/provider failure.
        return /not activatable|dbus|d-bus|failed|cannot|error/iu.test(text) ? 'unavailable' : 'reachable';
      }
    },
    async bciSession(profile) {
      const path = join(roots.state, 'portales', 'bci-pyme', profile, 'browser', 'session-state.json');
      try {
        const parsed = JSON.parse(await readFile(path, 'utf8')) as { cookies?: { expires?: number }[] };
        const expiries = (parsed.cookies ?? []).map((cookie) => cookie.expires ?? -1).filter((value) => value > 0);
        const earliest = expiries.length === 0 ? null : new Date(Math.min(...expiries) * 1000).toISOString();
        return { present: true, earliestExpiry: earliest };
      } catch {
        return { present: false, earliestExpiry: null };
      }
    },
    async siiSession(profile) {
      const path = join(roots.data, 'portales', 'sii', profile, 'session.json');
      try {
        const parsed = JSON.parse(await readFile(path, 'utf8')) as { www2?: { expiresAt?: string | null } };
        return { present: true, www2ExpiresAt: parsed.www2?.expiresAt ?? null };
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { present: false, www2ExpiresAt: null };
        return 'unavailable';
      }
    },
    async breaker(service, profile) {
      if (service !== 'bci-pyme' && service !== 'sii') return 'unsupported';
      return stat(join(roots.state, 'portales', service, 'login-breakers', profile)).then(() => true, () => false);
    },
  };
}

const SERVICES: Record<string, { browser: BrowserRequirement; needs: string[]; keyring: boolean; session: 'bci' | 'sii' | 'none' }> = {
  'bci-pyme': { browser: 'headed', needs: ['xvfb-run'], keyring: true, session: 'bci' },
  sag: { browser: 'none', needs: ['pdftotext'], keyring: false, session: 'none' },
  sii: { browser: 'headless', needs: [], keyring: true, session: 'sii' },
};

export function isDoctorService(value: string): boolean {
  return value in SERVICES;
}

async function privateDirectory(path: string): Promise<CheckStatus> {
  try {
    const info = await stat(path);
    return (info.mode & 0o077) === 0 ? 'ok' : 'fail';
  } catch {
    return 'skipped';
  }
}

function worst(checks: readonly DoctorCheck[]): CheckStatus {
  const order: CheckStatus[] = ['skipped', 'ok', 'warn', 'fail'];
  return checks.reduce<CheckStatus>((current, check) => (order.indexOf(check.status) > order.indexOf(current) ? check.status : current), 'ok');
}

/** Runs every local readiness check. Never authenticates or contacts a portal. */
export async function runDoctor(input: { service?: string; profile: string }, probes: DoctorProbes): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const services = input.service === undefined ? Object.keys(SERVICES) : [input.service];
  const version = await probes.version();
  checks.push(version.stale
    ? { name: 'build', status: 'warn', detail: `The executable is stale: ${version.staleReasons.join(', ')}.`, nextAction: 'npm run update' }
    : { name: 'build', status: 'ok', detail: `Build matches the checkout (${version.packageVersion}).` });
  const major = Number(/^v(\d+)/u.exec(version.node)?.[1] ?? '0');
  checks.push(major >= 22
    ? { name: 'node', status: 'ok', detail: `Node ${version.node}.` }
    : { name: 'node', status: 'fail', detail: `Node ${version.node} is older than the supported 22.`, nextAction: 'Install Node 22 or newer.' });

  const needsBrowser = services.some((slug) => SERVICES[slug]?.browser !== 'none');
  if (needsBrowser) {
    const chromium = await probes.chromiumExecutable();
    checks.push(chromium === null
      ? { name: 'chromium', status: 'fail', detail: 'The Playwright Chromium executable is missing.', nextAction: 'npx playwright install chromium' }
      : { name: 'chromium', status: 'ok', detail: 'Playwright Chromium executable is present.' });
  }
  for (const slug of services) {
    const definition = SERVICES[slug];
    if (definition === undefined) continue;
    for (const binary of definition.needs) {
      const present = await probes.onPath(binary);
      checks.push(present
        ? { name: `${slug}:${binary}`, status: 'ok', detail: `${binary} is on PATH.` }
        : { name: `${slug}:${binary}`, status: 'fail', detail: `${binary} is required by ${slug} and is not on PATH.`, nextAction: `Install ${binary}.` });
    }
    checks.push({ name: `${slug}:browser-mode`, status: 'ok', detail: `Browser mode would be ${browserModeFor(definition.browser, probes.env)}.` });
  }

  if (services.some((slug) => SERVICES[slug]?.keyring)) {
    const keyring = await probes.secretService();
    checks.push(keyring === 'not-found'
      ? { name: 'keyring', status: 'fail', detail: 'secret-tool is not installed.', nextAction: 'Install libsecret (secret-tool).' }
      : keyring === 'unavailable'
        ? { name: 'keyring', status: 'fail', detail: 'The Secret Service is not reachable on the session bus.', nextAction: 'Start a Secret Service provider (gnome-keyring or KWallet secret-service compat) and unlock it.' }
        : { name: 'keyring', status: 'ok', detail: 'Secret Service is reachable.' });
  }

  for (const [name, path] of [['state-dir', join(probes.roots.state, 'portales')], ['data-dir', join(probes.roots.data, 'portales')]] as const) {
    const status = await privateDirectory(path);
    checks.push(status === 'skipped'
      ? { name, status, detail: 'Directory does not exist yet.' }
      : status === 'ok'
        ? { name, status, detail: 'Private directory permissions are 0700.' }
        : { name, status, detail: 'Directory is readable by group or others.', nextAction: `chmod 700 ${path}` });
  }

  for (const slug of services) {
    const definition = SERVICES[slug];
    if (definition === undefined) continue;
    if (definition.session === 'bci') {
      const session = await probes.bciSession(input.profile);
      const expired = session.earliestExpiry !== null && Date.parse(session.earliestExpiry) < probes.now().getTime();
      checks.push(!session.present
        ? { name: `${slug}:session`, status: 'warn', detail: 'No saved browser session for this profile.', nextAction: `portales bci-pyme auth login --profile ${input.profile}` }
        : expired
          ? { name: `${slug}:session`, status: 'warn', detail: 'A saved session exists but at least one cookie has expired.', nextAction: `portales bci-pyme auth login --profile ${input.profile}` }
          : { name: `${slug}:session`, status: 'ok', detail: 'A saved session is present (local check only).' });
    } else if (definition.session === 'sii') {
      const session = await probes.siiSession(input.profile);
      checks.push(session === 'unavailable'
        ? { name: `${slug}:session`, status: 'fail', detail: 'The local SII session file could not be read.', nextAction: `portales sii auth logout --profile ${input.profile}` }
        : !session.present
          ? { name: `${slug}:session`, status: 'warn', detail: 'No local SII session for this profile.', nextAction: `portales sii auth login --profile ${input.profile}` }
          : { name: `${slug}:session`, status: 'ok', detail: 'A local SII session is present (local check only).' });
    }
    const breaker = await probes.breaker(slug, input.profile);
    if (breaker !== 'unsupported') {
      checks.push(breaker
        ? { name: `${slug}:login-breaker`, status: 'fail', detail: 'The login breaker is tripped; no new login is permitted.', nextAction: `portales ${slug} auth breaker status --profile ${input.profile} --json` }
        : { name: `${slug}:login-breaker`, status: 'ok', detail: 'The login breaker is clear.' });
    }
    if (definition.browser !== 'none') {
      const lock = await readServiceLock(slug, input.profile, probes.roots.state);
      checks.push(lock === null
        ? { name: `${slug}:lock`, status: 'ok', detail: 'No active run holds this service/profile.' }
        : { name: `${slug}:lock`, status: 'warn', detail: `Run ${lock.runId} (${lock.operation}) holds this service/profile.`, nextAction: `portales runs show ${lock.runId} --json` });
    }
  }

  const destinations = await access(destinationsConfigPath(probes.roots.config)).then(() => true, () => false);
  checks.push(destinations
    ? { name: 'destinations', status: 'ok', detail: 'A private destination configuration exists.' }
    : { name: 'destinations', status: 'skipped', detail: 'No destination aliases configured; artifacts use the default isolated directories.' });

  const requirement = input.service === undefined ? 'none' : SERVICES[input.service]?.browser ?? 'none';
  return { service: input.service ?? null, profile: input.profile, status: worst(checks), browserMode: browserModeFor(requirement, probes.env), live: false, checks };
}
