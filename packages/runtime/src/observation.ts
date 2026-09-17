import { mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Contract, controlLabel, countMatches, expectedCountText } from './contracts.js';
import type { Classification } from './page-state.js';
import { stateRoot } from './paths.js';

/** Allowlisted structural evidence captured by observation mode. No values, HTML, cookies, or bodies. */
export interface Observation {
  schemaVersion: '1';
  runId: string;
  service: string;
  operation: string;
  observedAt: string;
  browserMode: string;
  states: ObservedState[];
  /** JSON key paths only, per named response. */
  responseFingerprints: Record<string, string[]>;
  stoppedBefore: string | null;
}

export interface ObservedState {
  /** Contract state name that was expected at this point. */
  expectedState: string;
  classification: Classification;
  routeFragment: string;
  frameNames: string[];
  controls: { control: string; visibleCount: number }[];
  readinessMarkers: { marker: string; present: boolean }[];
  ariaSnapshot: string;
}

export interface Proposal {
  schemaVersion: '1';
  runId: string;
  contractPath: string | null;
  facts: string[];
  hypotheses: string[];
  proposedDiff: { state: string; control: string; expected: string; observed: number }[];
}

const RUT_LIKE = /\b\d{1,3}(?:\.\d{3}){1,2}-?[\dkK]\b|\b\d{7,9}-[\dkK]\b/gu;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu;
const LONG_NUMBER = /\b\d{4,}\b/gu;
const MONEY = /\$\s?[\d.,]+/gu;

/** Replaces account-identifying tokens with placeholders; keeps structure words. */
export function sanitizeText(value: string): string {
  return value
    .replace(EMAIL, '<email>')
    .replace(RUT_LIKE, '<rut>')
    .replace(MONEY, '<amount>')
    .replace(LONG_NUMBER, '<number>');
}

/** Keeps the path only, replacing numeric or long opaque segments with `<id>`. */
export function sanitizeRoute(url: string): string {
  let path: string;
  try { path = new URL(url).pathname; } catch { path = url.split(/[?#]/u)[0] ?? ''; }
  return path.split('/').map((segment) => (/^\d+$/u.test(segment) || /^[0-9a-f]{16,}$/iu.test(segment) ? '<id>' : segment)).join('/');
}

/** Reduces a Playwright aria snapshot to roles and names: quoted values, numbers, and free text are placeholders. */
export function sanitizeAriaSnapshot(snapshot: string, maxLines = 400): string {
  const lines = snapshot.split('\n').slice(0, maxLines).map((line) => {
    const indent = /^\s*/u.exec(line)?.[0] ?? '';
    const body = line.trim();
    if (body === '') return '';
    const match = /^- ([a-z]+)(?: "([^"]*)")?(.*)$/u.exec(body);
    if (match === null) return `${indent}- text: <text>`;
    const [, role, name, rest] = match;
    if (role === 'text') return `${indent}- text: <text>`;
    const cleanName = name === undefined ? '' : ` "${sanitizeText(name)}"`;
    const flags = (rest ?? '').includes('[disabled]') ? ' [disabled]' : '';
    return `${indent}- ${role ?? ''}${cleanName}${flags}${(rest ?? '').trimEnd().endsWith(':') ? ':' : ''}`;
  });
  return lines.join('\n');
}

/** Key paths of a JSON value with every leaf value dropped. */
export function responseShape(value: unknown, prefix = '', depth = 0, out: string[] = []): string[] {
  if (depth > 6) return out;
  if (Array.isArray(value)) {
    if (value.length > 0) responseShape(value[0], `${prefix}[]`, depth + 1, out);
    else out.push(`${prefix}[]`);
    return out;
  }
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value).sort().slice(0, 100)) responseShape((value as Record<string, unknown>)[key], prefix === '' ? key : `${prefix}.${key}`, depth + 1, out);
    return out;
  }
  out.push(`${prefix}:${value === null ? 'null' : typeof value}`);
  return out;
}

export function observationsDirectory(runId: string, root = stateRoot()): string {
  return join(root, 'portales', 'observations', runId);
}

async function writePrivate(path: string, value: unknown): Promise<void> {
  const file = await open(path, 'w', 0o600);
  try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); } finally { await file.close(); }
}

/** Builds the sanitized diff proposal between the loaded contract and the observation. Facts and hypotheses stay separate. */
export function proposeContractDiff(runId: string, contract: { path: string; contract: Contract } | null, observation: Observation): Proposal {
  const facts: string[] = [];
  const hypotheses: string[] = [];
  const proposedDiff: Proposal['proposedDiff'] = [];
  for (const state of observation.states) {
    facts.push(`At expected state ${state.expectedState}: classified as ${state.classification.kind}${state.classification.state === null ? '' : ` (${state.classification.state})`}; route ${state.routeFragment}; frames ${state.frameNames.join(', ') || '(none)'}.`);
    const expected = contract?.contract.pageStates[state.expectedState];
    if (expected === undefined) {
      hypotheses.push(`The contract declares no page state named ${state.expectedState}; the observation may belong to a new branch.`);
      continue;
    }
    for (const item of expected.controls) {
      const observed = state.controls.find((entry) => entry.control === controlLabel(item))?.visibleCount ?? 0;
      if (!countMatches(item.expectedVisibleCount, observed)) {
        facts.push(`State ${state.expectedState}: expected ${expectedCountText(item.expectedVisibleCount)} visible ${controlLabel(item)}, observed ${String(observed)}.`);
        proposedDiff.push({ state: state.expectedState, control: controlLabel(item), expected: expectedCountText(item.expectedVisibleCount), observed });
        hypotheses.push(observed === 0 ? `${controlLabel(item)} may have been renamed, moved into another frame, or removed in state ${state.expectedState}.` : `${controlLabel(item)} cardinality changed in state ${state.expectedState}; the selector may now match a wrapper and its native control.`);
      }
    }
    for (const marker of state.readinessMarkers.filter((entry) => !entry.present)) {
      facts.push(`State ${state.expectedState}: readiness marker ${marker.marker} was not present.`);
      hypotheses.push(`The readiness condition for ${state.expectedState} may have changed; confirm in a headed browser before editing the contract.`);
    }
  }
  if (observation.stoppedBefore !== null) facts.push(`Observation stopped before ${observation.stoppedBefore} by design (read-only).`);
  if (proposedDiff.length === 0 && contract !== null) facts.push('No structural difference against the dated contract.');
  return { schemaVersion: '1', runId, contractPath: contract?.path ?? null, facts, hypotheses, proposedDiff };
}

/** Writes observed.json and proposal.json under the private observations directory. */
export async function writeObservationBundle(observation: Observation, proposal: Proposal, root = stateRoot()): Promise<string> {
  const directory = observationsDirectory(observation.runId, root);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writePrivate(join(directory, 'observed.json'), observation);
  await writePrivate(join(directory, 'proposal.json'), proposal);
  return directory;
}

export async function readObservationBundle(runId: string, root = stateRoot()): Promise<{ observation: Observation; proposal: Proposal } | null> {
  try {
    const directory = observationsDirectory(runId, root);
    return {
      observation: JSON.parse(await readFile(join(directory, 'observed.json'), 'utf8')) as Observation,
      proposal: JSON.parse(await readFile(join(directory, 'proposal.json'), 'utf8')) as Proposal,
    };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
