import type { BrowserMode, BrowserRequirement } from './browser-mode.js';
import { PortalError, invalidInput, type PortalErrorCode, type Stage, type ValidationDetail } from './errors.js';
import type { ArtifactDescriptor } from './artifacts.js';

export type Effect = 'read' | 'write' | 'destructive';
export type AuthRequirement = 'public' | 'session' | 'interactive';
export type ArgumentKind = 'string' | 'integer' | 'boolean' | 'path' | 'enum' | 'date' | 'period';

export interface ArgumentSpec {
  /** Option name without dashes (`business-id`) or positional name (`periodo`). */
  name: string;
  kind: ArgumentKind;
  description: string;
  required?: boolean;
  repeatable?: boolean;
  /** Valid values for `enum`. */
  values?: readonly string[];
  /** Human constraint shown in errors, e.g. `YYYY-MM`. */
  expected?: string;
  pattern?: RegExp;
  /** Exact public command that lists valid values. `<profile>` is substituted when known. */
  discoverWith?: string;
  /** Deprecated option name still accepted for this argument. */
  deprecatedAlias?: string;
  /** Value is private (never echoed in errors or records). */
  private?: boolean;
  default?: string;
}

export type ParsedValue = string | number | boolean | string[];

export interface ParsedInput {
  positionals: Record<string, string>;
  options: Record<string, ParsedValue>;
  profile: string | null;
  human: boolean;
  /** Raw arguments after the command path, for legacy passthrough runners only. */
  rest: string[];
}

export interface RunContext<D = unknown> {
  runId: string;
  service: string;
  operation: string;
  profile: string | null;
  browserMode: BrowserMode;
  contractVersion: string | null;
  stage(stage: Stage, detail?: string): void;
  /** Bounded diagnostic line on STDERR (already JSON-encoded by the caller). */
  stderr(line: string): void;
  stdoutRaw(line: string): void;
  recordArtifact(input: Omit<ArtifactDescriptor, 'schemaVersion' | 'artifactId' | 'runId' | 'service' | 'operation' | 'profile'> & { profile?: string }): Promise<ArtifactDescriptor>;
  deps: D;
  env: NodeJS.ProcessEnv;
}

export interface CommandSpec<D = unknown> {
  service: string;
  /** Words after the service, e.g. `['cartolas', 'download']`. Operation is `path.join('.')`. */
  path: readonly string[];
  summary: string;
  description?: string;
  effect: Effect;
  auth: AuthRequirement;
  browser: BrowserRequirement;
  profile: 'required' | 'optional' | 'none';
  positionals?: readonly ArgumentSpec[];
  options?: readonly ArgumentSpec[];
  confirm?: { description: string };
  output: { description: string; schema?: unknown };
  errors: readonly PortalErrorCode[];
  contractRef?: string;
  /** Observation date of the contract that this command relies on. */
  contractVersion?: string;
  /** Commands that discover constrained values for this command. */
  discoverWith?: readonly string[];
  /** Runner forwards raw args; parsing is not registry-driven yet. */
  legacy?: boolean;
  /** Emitted verbatim in the result envelope (`--json` accepted, no other output). */
  run(input: ParsedInput, context: RunContext<D>): Promise<unknown>;
}

export interface ServiceSpec<D = unknown> {
  slug: string;
  title: string;
  description: string;
  docs: string;
  commands: readonly CommandSpec<D>[];
}

export interface Registry<D = unknown> {
  services: readonly ServiceSpec<D>[];
  globals: readonly CommandSpec<D>[];
}

export function operationOf(spec: Pick<CommandSpec, 'path'>): string {
  return spec.path.join('.');
}

export function commandLine(spec: Pick<CommandSpec, 'service' | 'path'>): string {
  return spec.service === 'portales' ? `portales ${spec.path.join(' ')}` : `portales ${spec.service} ${spec.path.join(' ')}`;
}

export function findCommand<D>(registry: Registry<D>, words: readonly string[]): { spec: CommandSpec<D>; consumed: number } | undefined {
  const globals = matchPrefix(registry.globals, words);
  if (globals !== undefined) return globals;
  const service = registry.services.find((item) => item.slug === words[0]);
  if (service === undefined) return undefined;
  const match = matchPrefix(service.commands, words.slice(1));
  return match === undefined ? undefined : { spec: match.spec, consumed: match.consumed + 1 };
}

function matchPrefix<D>(commands: readonly CommandSpec<D>[], words: readonly string[]): { spec: CommandSpec<D>; consumed: number } | undefined {
  let best: { spec: CommandSpec<D>; consumed: number } | undefined;
  for (const spec of commands) {
    if (spec.path.length > words.length) continue;
    if (spec.path.every((word, index) => words[index] === word) && (best === undefined || spec.path.length > best.consumed)) {
      best = { spec, consumed: spec.path.length };
    }
  }
  return best;
}

const PROFILE_OPTION: ArgumentSpec = {
  name: 'profile', kind: 'string', description: 'Local profile name (keyring account and private session directory).', pattern: /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u, expected: 'safe local name of at most 64 characters',
};

export function effectiveOptions(spec: CommandSpec): ArgumentSpec[] {
  const options = [...(spec.options ?? [])];
  if (spec.profile !== 'none') options.unshift({ ...PROFILE_OPTION, required: spec.profile === 'required', ...(spec.profile === 'optional' ? { default: 'default' } : {}) });
  if (spec.confirm !== undefined) options.push({ name: 'confirm', kind: 'string', description: spec.confirm.description, private: true });
  return options;
}

function substituteProfile(command: string | undefined, profile: string | null): string | undefined {
  if (command === undefined) return undefined;
  return profile === null ? command : command.replaceAll('<profile>', profile);
}

function describeCommand(spec: CommandSpec): string {
  return `portales describe ${spec.service === 'portales' ? '' : `${spec.service} `}${spec.path.join(' ')} --json`;
}

function validate(spec: CommandSpec, argument: ArgumentSpec, raw: string, profile: string | null, flag: string): ParsedValue {
  const detail = (expected: string): ValidationDetail => ({
    field: flag, expected, ...(argument.private ? {} : { received: raw }),
    ...(substituteProfile(argument.discoverWith, profile) === undefined ? {} : { discoverWith: substituteProfile(argument.discoverWith, profile) as string }),
  });
  const fail = (expected: string): never => {
    throw invalidInput(`${flag} must be ${expected}.${argument.discoverWith === undefined ? '' : ` Discover values with: ${substituteProfile(argument.discoverWith, profile) as string}`}`, [detail(expected)], {
      nextCommand: substituteProfile(argument.discoverWith, profile) ?? describeCommand(spec),
    });
  };
  switch (argument.kind) {
    case 'boolean': return true;
    case 'integer': {
      if (!/^[1-9]\d*$/u.test(raw)) return fail(argument.expected ?? 'a positive integer');
      return Number(raw);
    }
    case 'enum': {
      if (!(argument.values ?? []).includes(raw)) return fail(`one of: ${(argument.values ?? []).join(', ')}`);
      return raw;
    }
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return fail('a date formatted YYYY-MM-DD');
      return raw;
    }
    case 'period': {
      if (!/^\d{4}-\d{2}$/u.test(raw)) return fail('a period formatted YYYY-MM');
      return raw;
    }
    case 'path':
    case 'string': {
      if (raw === '' || raw.startsWith('--')) return fail(argument.expected ?? 'a non-empty value');
      if (argument.pattern !== undefined && !argument.pattern.test(raw)) return fail(argument.expected ?? 'a value matching the documented format');
      return raw;
    }
  }
}

/** Parses the words after the command path against the spec, producing actionable errors. */
export function parseArguments(spec: CommandSpec, words: readonly string[]): ParsedInput {
  const options = effectiveOptions(spec);
  const positionals = spec.positionals ?? [];
  const parsed: ParsedInput = { positionals: {}, options: {}, profile: null, human: false, rest: [...words] };
  if (spec.legacy) {
    const profileIndex = words.indexOf('--profile');
    parsed.profile = profileIndex >= 0 ? words[profileIndex + 1] ?? null : (spec.profile === 'optional' ? 'default' : null);
    parsed.human = words.includes('--human');
    return parsed;
  }
  const profileIndex = words.indexOf('--profile');
  const earlyProfile = profileIndex >= 0 ? words[profileIndex + 1] ?? null : null;
  let positionalIndex = 0;
  for (let index = 0; index < words.length; index++) {
    const word = words[index] as string;
    if (word === '--human' || word === '--json') { parsed.human = parsed.human || word === '--human'; continue; }
    if (word.startsWith('--')) {
      const name = word.slice(2);
      const argument = options.find((item) => item.name === name || item.deprecatedAlias === name);
      if (argument === undefined) {
        throw invalidInput(`Unknown option ${word}. See ${describeCommand(spec)}.`, [{ field: word, expected: `one of: ${options.map((item) => `--${item.name}`).join(', ') || 'no options'}` }], { nextCommand: describeCommand(spec) });
      }
      if (argument.deprecatedAlias === name) {
        parsed.options[`${argument.name}DeprecatedAlias`] = name;
      }
      let raw = 'true';
      if (argument.kind !== 'boolean') {
        const next = words[index + 1];
        if (next === undefined || next.startsWith('--')) {
          throw invalidInput(`${word} requires a value.`, [{ field: word, expected: argument.expected ?? argument.kind, ...(argument.discoverWith === undefined ? {} : { discoverWith: substituteProfile(argument.discoverWith, earlyProfile) as string }) }], { nextCommand: substituteProfile(argument.discoverWith, earlyProfile) ?? describeCommand(spec) });
        }
        raw = next;
        index++;
      }
      const value = validate(spec, argument, raw, earlyProfile, `--${argument.name}`);
      if (argument.repeatable) {
        const existing = parsed.options[argument.name];
        parsed.options[argument.name] = Array.isArray(existing) ? [...existing, String(value)] : [String(value)];
      } else if (argument.name in parsed.options) {
        throw invalidInput(`--${argument.name} was given more than once.`, [{ field: `--${argument.name}`, expected: 'a single value' }], { nextCommand: describeCommand(spec) });
      } else {
        parsed.options[argument.name] = value;
      }
      continue;
    }
    const positional = positionals[positionalIndex];
    if (positional === undefined) {
      throw invalidInput(`Unexpected argument: ${word}.`, [{ field: 'arguments', expected: positionals.length === 0 ? 'no positional arguments' : `at most ${String(positionals.length)} positional argument(s): ${positionals.map((item) => `<${item.name}>`).join(' ')}` }], { nextCommand: describeCommand(spec) });
    }
    parsed.positionals[positional.name] = String(validate(spec, positional, word, earlyProfile, `<${positional.name}>`));
    positionalIndex++;
  }
  for (const positional of positionals) {
    if (positional.required !== false && !(positional.name in parsed.positionals)) {
      throw invalidInput(`<${positional.name}> is required.`, [{ field: `<${positional.name}>`, expected: positional.expected ?? positional.kind, ...(positional.discoverWith === undefined ? {} : { discoverWith: substituteProfile(positional.discoverWith, earlyProfile) as string }) }], { nextCommand: substituteProfile(positional.discoverWith, earlyProfile) ?? describeCommand(spec) });
    }
  }
  for (const option of options) {
    if (!(option.name in parsed.options)) {
      if (option.default !== undefined) parsed.options[option.name] = option.default;
      else if (option.required) {
        throw invalidInput(`--${option.name} is required.${option.discoverWith === undefined ? '' : ` Discover values with: ${substituteProfile(option.discoverWith, earlyProfile) as string}`}`, [{ field: `--${option.name}`, expected: option.expected ?? option.kind, ...(option.discoverWith === undefined ? {} : { discoverWith: substituteProfile(option.discoverWith, earlyProfile) as string }) }], { nextCommand: substituteProfile(option.discoverWith, earlyProfile) ?? describeCommand(spec) });
      }
    }
  }
  const profile = parsed.options.profile;
  parsed.profile = typeof profile === 'string' ? profile : null;
  return parsed;
}

function argumentJson(argument: ArgumentSpec, kindLabel: 'option' | 'positional') {
  return {
    name: kindLabel === 'option' ? `--${argument.name}` : `<${argument.name}>`,
    kind: argument.kind,
    required: argument.required === true,
    repeatable: argument.repeatable === true,
    description: argument.description,
    ...(argument.values === undefined ? {} : { values: [...argument.values] }),
    ...(argument.expected === undefined ? {} : { expected: argument.expected }),
    ...(argument.discoverWith === undefined ? {} : { discoverWith: argument.discoverWith }),
    ...(argument.deprecatedAlias === undefined ? {} : { deprecatedAlias: `--${argument.deprecatedAlias}` }),
    ...(argument.private ? { private: true } : {}),
    ...(argument.default === undefined ? {} : { default: argument.default }),
  };
}

/** Machine-readable contract of one operation, generated from the spec. */
export function describeSpec(spec: CommandSpec) {
  return {
    service: spec.service,
    operation: operationOf(spec),
    command: commandLine(spec),
    summary: spec.summary,
    ...(spec.description === undefined ? {} : { description: spec.description }),
    effect: spec.effect,
    auth: spec.auth,
    browser: spec.browser,
    profile: spec.profile,
    positionals: (spec.positionals ?? []).map((item) => argumentJson(item, 'positional')),
    options: effectiveOptions(spec).map((item) => argumentJson(item, 'option')),
    confirm: spec.confirm ?? null,
    output: spec.output,
    errors: [...spec.errors],
    contractRef: spec.contractRef ?? null,
    contractVersion: spec.contractVersion ?? null,
    discoverWith: [...(spec.discoverWith ?? [])],
    legacyParsing: spec.legacy === true,
  };
}

export function catalogJson(registry: Registry) {
  return {
    services: registry.services.map((service) => ({
      slug: service.slug,
      title: service.title,
      description: service.description,
      docs: service.docs,
      commands: service.commands.map(describeSpec),
    })),
    globals: registry.globals.map(describeSpec),
  };
}

function usageLine(spec: CommandSpec): string {
  const positionals = (spec.positionals ?? []).map((item) => item.required === false ? `[${item.name}]` : `<${item.name}>`).join(' ');
  const options = effectiveOptions(spec).map((item) => {
    const value = item.kind === 'boolean' ? '' : ` <${item.name}>`;
    const text = `--${item.name}${value}`;
    return item.required ? text : `[${text}]`;
  }).join(' ');
  return [commandLine(spec), positionals, options].filter((item) => item !== '').join(' ');
}

/** Renders hierarchical help for a prefix without touching a profile or a portal. */
export function renderHelp(registry: Registry, words: readonly string[]): string {
  const lines: string[] = [];
  if (words.length === 0) {
    lines.push('portales <service> <resource> <action> [options]', '', 'Services:');
    for (const service of registry.services) lines.push(`  ${service.slug.padEnd(12)} ${service.description}`);
    lines.push('', 'Global commands:');
    for (const spec of registry.globals) lines.push(`  ${usageLine(spec).padEnd(60)} ${spec.summary}`);
    lines.push('', 'Use portales <service> --help, portales <service> <resource> --help, portales catalog --json, or portales describe <service> <resource> <action> --json.');
    return `${lines.join('\n')}\n`;
  }
  const service = registry.services.find((item) => item.slug === words[0]);
  const commands = service === undefined ? registry.globals.filter((item) => item.path[0] === words[0]) : service.commands;
  const prefix = service === undefined ? words : words.slice(1);
  const matches = commands.filter((spec) => prefix.every((word, index) => spec.path[index] === word));
  if (matches.length === 0) {
    throw invalidInput(`Unknown command: portales ${words.join(' ')}.`, [{ field: 'command', expected: service === undefined ? `one of: ${registry.services.map((item) => item.slug).join(', ')}` : `one of: ${[...new Set(service.commands.map((item) => item.path[0]))].join(', ')}` }], { nextCommand: service === undefined ? 'portales --help' : `portales ${service.slug} --help` });
  }
  if (service !== undefined && prefix.length === 0) lines.push(`${service.title}: ${service.description}`, `Docs: ${service.docs}`, '');
  const full = matches.length === 1 && matches[0] !== undefined && matches[0].path.length === prefix.length;
  for (const spec of matches) {
    lines.push(usageLine(spec), `  ${spec.summary} [effect: ${spec.effect}, auth: ${spec.auth}, browser: ${spec.browser}]`);
    if (full || prefix.length >= 1) {
      if (spec.description !== undefined) lines.push(`  ${spec.description}`);
      for (const item of spec.positionals ?? []) lines.push(`  <${item.name}>  ${item.description}${item.discoverWith === undefined ? '' : ` Discover with: ${item.discoverWith}`}`);
      for (const item of effectiveOptions(spec)) lines.push(`  --${item.name}${item.kind === 'boolean' ? '' : ` <${item.name}>`}  ${item.required ? '(required) ' : ''}${item.description}${item.values === undefined ? '' : ` Values: ${item.values.join(', ')}.`}${item.discoverWith === undefined ? '' : ` Discover with: ${item.discoverWith}`}`);
      if (spec.contractRef !== undefined) lines.push(`  Contract: ${spec.contractRef}${spec.contractVersion === undefined ? '' : ` (observed ${spec.contractVersion})`}`);
      lines.push(`  Describe: portales describe ${spec.service === 'portales' ? '' : `${spec.service} `}${spec.path.join(' ')} --json`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

export function requireConfirm(input: ParsedInput, expected: string, what: string): void {
  const confirm = input.options.confirm;
  if (confirm === undefined) {
    throw new PortalError('CONFIRMATION_REQUIRED', `Pass --confirm with ${what} to execute this operation.`, { recovery: { nextAction: `Review the preview, then pass --confirm ${what}.` } });
  }
  if (confirm !== expected) {
    throw new PortalError('CONFIRMATION_REQUIRED', `--confirm must equal ${what}.`, { recovery: { nextAction: `Pass --confirm with exactly ${what}.` } });
  }
}
