import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { PortalError, invalidInput } from './errors.js';

/** A control the contract expects on a page state. `css` is allowed only when the observed control has no accessible role/name. */
const control = z.object({
  role: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  /** `false` when the observed accessible name embeds volatile text (an icon-font glyph) after the recorded name; the name then matches as a substring. Default: exact. */
  exact: z.boolean().optional(),
  css: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  expectedVisibleCount: z.union([z.number().int().min(0), z.object({ min: z.number().int().min(0), max: z.number().int().min(0).optional() })]),
}).strict().refine((item) => item.role !== undefined || item.css !== undefined || item.text !== undefined, 'a control needs role, css, or text');

const pageState = z.object({
  description: z.string().min(1),
  /** Path fragments only; query strings and account identifiers are never recorded. */
  routeFragments: z.array(z.string().min(1).refine((value) => !value.includes('?'), 'no query strings')).default([]),
  frameNames: z.array(z.string().min(1)).default([]),
  readinessMarkers: z.array(z.object({ role: z.string().min(1).optional(), name: z.string().min(1).optional(), css: z.string().min(1).optional(), text: z.string().min(1).optional() }).strict()).default([]),
  controls: z.array(control).default([]),
  /** Playwright aria snapshot with every value stripped: roles and names only. */
  ariaSnapshot: z.string().optional(),
  /** Stable classification this state maps to. */
  kind: z.enum(['login-page', 'authenticated-shell', 'provider-error', 'empty-valid-result', 'loading', 'blocked', 'result']).default('result'),
}).strict();

const step = z.discriminatedUnion('step', [
  z.object({ step: z.literal('goto'), destination: z.string().min(1) }).strict(),
  z.object({ step: z.literal('expect-state'), state: z.string().min(1), timeoutMs: z.number().int().positive().optional() }).strict(),
  z.object({ step: z.literal('click'), role: z.string().min(1).optional(), name: z.string().min(1).optional(), exact: z.boolean().optional(), css: z.string().min(1).optional(), text: z.string().min(1).optional(), frame: z.string().min(1).optional(), index: z.union([z.number().int().min(0), z.literal('selected')]).optional() }).strict(),
  z.object({ step: z.literal('fill'), role: z.string().min(1).optional(), name: z.string().min(1).optional(), css: z.string().min(1).optional(), from: z.string().min(1) }).strict(),
  z.object({ step: z.literal('expect-frame'), frame: z.string().min(1), timeoutMs: z.number().int().positive().optional() }).strict(),
  z.object({ step: z.literal('expect-download'), timeoutMs: z.number().int().positive().optional() }).strict(),
  z.object({ step: z.literal('read'), what: z.string().min(1) }).strict(),
  z.object({ step: z.literal('stop'), reason: z.string().min(1) }).strict(),
]);

export const contractSchema = z.object({
  schemaVersion: z.literal('1'),
  service: z.string().regex(/^[a-z0-9-]+$/u),
  operations: z.array(z.string().regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/u)).min(1),
  observedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  /** Markdown explanation beside this file. */
  explanation: z.string().min(1),
  effect: z.enum(['read', 'write', 'destructive']),
  pageStates: z.record(z.string().regex(/^[a-z0-9-]+$/u), pageState),
  flow: z.array(step).default([]),
  successConditions: z.array(z.string().min(1)).min(1),
  stopConditions: z.array(z.string().min(1)).min(1),
  supportedBranches: z.array(z.string().min(1)).default([]),
  /** Key paths (no values) that a JSON response must contain, when the operation replays a request. */
  responseFingerprints: z.record(z.string(), z.array(z.string().min(1))).default({}),
}).strict();

export type Contract = z.infer<typeof contractSchema>;
export type ContractPageState = z.infer<typeof pageState>;
export type ContractControl = z.infer<typeof control>;
export type FlowStep = z.infer<typeof step>;

export function parseContract(value: unknown, source = 'contract'): Contract {
  const parsed = contractSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidInput(`${source} is not a valid portal contract.`, parsed.error.issues.slice(0, 10).map((issue) => ({ field: issue.path.join('.') || '(root)', expected: issue.message })));
  }
  return parsed.data;
}

export async function validateContractFile(path: string): Promise<Contract> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (error: unknown) {
    throw invalidInput(`${path} could not be read as JSON.`, [{ field: 'file', expected: 'readable JSON contract', received: path }], { cause: error } as never);
  }
  return parseContract(raw, path);
}

/** Every `services/<service>/docs/contracts/*.json` in the checkout. */
export async function listContractFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  let services: string[];
  try { services = await readdir(join(root, 'services')); } catch { return files; }
  for (const service of services) {
    const directory = join(root, 'services', service, 'docs', 'contracts');
    let names: string[];
    try { names = await readdir(directory); } catch { continue; }
    for (const name of names.filter((item) => item.endsWith('.json')).sort()) files.push(join(directory, name));
  }
  return files;
}

/** Loads the contract that declares `operation` for `service`, or null when none exists. */
export async function loadContract(root: string, service: string, operation: string): Promise<{ path: string; contract: Contract } | null> {
  for (const path of await listContractFiles(root)) {
    if (!path.includes(join('services', service, 'docs'))) continue;
    const contract = await validateContractFile(path);
    if (contract.service === service && contract.operations.includes(operation)) return { path, contract };
  }
  return null;
}

export function expectedCountText(expected: ContractControl['expectedVisibleCount']): string {
  if (typeof expected === 'number') return String(expected);
  return expected.max === undefined ? `at least ${String(expected.min)}` : `${String(expected.min)}..${String(expected.max)}`;
}

export function countMatches(expected: ContractControl['expectedVisibleCount'], observed: number): boolean {
  if (typeof expected === 'number') return observed === expected;
  return observed >= expected.min && (expected.max === undefined || observed <= expected.max);
}

export function controlLabel(item: { role?: string | undefined; name?: string | undefined; css?: string | undefined; text?: string | undefined }): string {
  if (item.role !== undefined) return item.name === undefined ? item.role : `${item.role} "${item.name}"`;
  if (item.text !== undefined) return `text "${item.text}"`;
  return `css ${item.css ?? '?'}`;
}

/** Throws the typed contract error the shared taxonomy expects for a structural mismatch. */
export function contractMismatch(input: { service: string; operation: string; state: string; expected: string; observed: string; contractRef: string; profile?: string; stage?: 'session-check' | 'navigate' | 'parse' | 'download' | 'verify' }): PortalError {
  return new PortalError('CONTRACT_MISMATCH', `Contract mismatch in ${input.operation} at page state ${input.state}: expected ${input.expected}, observed ${input.observed}.`, {
    recovery: {
      stage: input.stage ?? 'navigate',
      contractRef: input.contractRef,
      nextCommand: `portales ${input.service} observe ${input.operation} --profile ${input.profile ?? '<profile>'}`,
      nextAction: 'Do not broaden selectors or retry. Run observe, review the proposed contract diff, then repair the dated contract.',
    },
  });
}
