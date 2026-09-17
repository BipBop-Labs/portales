import { SCHEMA_VERSION, createStageRecorder } from '../../../packages/runtime/src/events.js';
import { PortalError, asPortalError, exitCodeFor } from '../../../packages/runtime/src/errors.js';
import { browserModeFor } from '../../../packages/runtime/src/browser-mode.js';
import { recordArtifact } from '../../../packages/runtime/src/artifacts.js';
import { acquireServiceLock, newRunId, pruneRunRecords, writeRunRecord, type RunRecord } from '../../../packages/runtime/src/runs.js';
import { stateRoot, dataRoot } from '../../../packages/runtime/src/paths.js';
import { findCommand, operationOf, parseArguments, renderHelp, type CommandSpec, type Registry, type RunContext } from '../../../packages/runtime/src/registry.js';
import type { CliDependencies } from './dependencies.js';
import { buildRegistry } from './registry.js';

export type { CliDependencies } from './dependencies.js';

interface Envelope {
  schemaVersion: typeof SCHEMA_VERSION;
  service: string;
  operation: string;
  runId: string;
}

function errorEnvelope(envelope: Envelope, failure: PortalError) {
  return {
    ...envelope,
    error: {
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable,
      ...failure.recovery,
      ...(failure.validation === undefined ? {} : { validation: failure.validation }),
    },
  };
}

/** Runs one public command: parse, lock, record, emit lifecycle events, and wrap the result. */
export async function runCli(args: string[], dependencies: CliDependencies): Promise<number> {
  const registry: Registry<CliDependencies> = dependencies.registry ?? buildRegistry();
  const env = dependencies.env ?? process.env;
  const startedAt = Date.now();
  const runId = newRunId(new Date(startedAt));
  let envelope: Envelope = { schemaVersion: SCHEMA_VERSION, service: 'portales', operation: 'cli', runId };
  try {
    if (args.length === 0 || args.includes('--help') || args[0] === 'help') {
      const words = args.filter((word) => word !== '--help' && word !== 'help');
      dependencies.stdout(renderHelp(registry, words));
      return 0;
    }
    const found = findCommand(registry, args);
    if (found === undefined) {
      const service = registry.services.find((item) => item.slug === args[0]);
      throw new PortalError('INVALID_INPUT', service === undefined ? `Unknown service or command: ${args[0] ?? ''}.` : `Unknown ${service.slug} command: ${args.slice(1, 3).join(' ')}.`, {
        validation: [{ field: 'command', expected: service === undefined ? `one of: ${registry.services.map((item) => item.slug).join(', ')}, or a global command` : `one of the commands listed by portales ${service.slug} --help` }],
        recovery: { nextCommand: service === undefined ? 'portales --help' : `portales ${service.slug} --help` },
      });
    }
    const spec = found.spec;
    envelope = { ...envelope, service: spec.service, operation: operationOf(spec) };
    const input = parseArguments(spec, args.slice(found.consumed));
    return await execute(spec, input, { registry, dependencies, env, runId, startedAt, envelope });
  } catch (error: unknown) {
    const failure = asPortalError(error);
    dependencies.stderr(`${JSON.stringify(errorEnvelope(envelope, failure))}\n`);
    return exitCodeFor(failure.code);
  }
}

async function execute(
  spec: CommandSpec<CliDependencies>,
  input: ReturnType<typeof parseArguments>,
  run: { registry: Registry<CliDependencies>; dependencies: CliDependencies; env: NodeJS.ProcessEnv; runId: string; startedAt: number; envelope: Envelope },
): Promise<number> {
  const { dependencies, env, runId, startedAt, envelope } = run;
  const browserMode = browserModeFor(spec.browser, env);
  const persist = spec.service !== 'portales';
  const recorder = createStageRecorder({
    runId, service: spec.service, operation: envelope.operation, browserMode, startedAt,
    write: (line) => { if (persist) dependencies.stderr(line); },
  });
  const state = dependencies.stateRoot ?? stateRoot(env);
  const data = dependencies.dataRoot ?? dataRoot(env);
  const record: RunRecord = {
    schemaVersion: '1', runId, service: spec.service, operation: envelope.operation, profile: input.profile,
    effect: spec.effect, startedAt: new Date(startedAt).toISOString(), endedAt: null, status: 'running', exitCode: null,
    browserMode, contractVersion: spec.contractVersion ?? null, packageVersion: dependencies.packageVersion ?? '0.0.0',
    commit: dependencies.commit ?? null, stages: recorder.timings as RunRecord['stages'], error: null, artifacts: [],
  };
  const context: RunContext<CliDependencies> = {
    runId, service: spec.service, operation: envelope.operation, profile: input.profile, browserMode,
    contractVersion: spec.contractVersion ?? null,
    stage: (stage, detail) => { recorder.stage(stage, detail); },
    stderr: (line) => { dependencies.stderr(line.endsWith('\n') ? line : `${line}\n`); },
    stdoutRaw: (line) => { dependencies.stdout(line); },
    recordArtifact: async (descriptor) => {
      const saved = await recordArtifact({ runId, service: spec.service, operation: envelope.operation, profile: descriptor.profile ?? input.profile ?? 'default', ...descriptor }, data);
      record.artifacts.push({ artifactId: saved.artifactId, mediaType: saved.mediaType, byteCount: saved.byteCount, sha256: saved.sha256, path: saved.path });
      return saved;
    },
    deps: dependencies, env,
  };
  let release: (() => Promise<void>) | undefined;
  let exitCode = 0;
  try {
    recorder.stage('preflight');
    if (spec.browser !== 'none' && input.profile !== null && persist) {
      const lock = await acquireServiceLock({ runId, service: spec.service, profile: input.profile, operation: envelope.operation }, state);
      if (!lock.acquired) {
        throw new PortalError('RUN_LOCKED', `Another run (${lock.active.runId}, ${lock.active.operation}) is using ${spec.service} profile ${input.profile}.`, {
          recovery: { activeRunId: lock.active.runId, nextCommand: `portales runs show ${lock.active.runId} --json` },
        });
      }
      release = lock.release;
    }
    const result = await spec.run(input, context);
    recorder.stage('completed');
    record.status = 'completed';
    if (result !== undefined) {
      const body = { ...envelope, browserMode, result };
      dependencies.stdout(`${JSON.stringify(body, null, input.human ? 2 : undefined)}\n`);
    }
  } catch (error: unknown) {
    const failure = asPortalError(error).withRecovery({
      ...(recorder.lastCompleted() === undefined ? {} : { lastCompletedStage: recorder.lastCompleted() as NonNullable<ReturnType<typeof recorder.lastCompleted>> }),
      ...(spec.contractRef === undefined ? {} : { contractRef: spec.contractRef }),
      ...(spec.contractVersion === undefined ? {} : { contractVersion: spec.contractVersion }),
    });
    const stageAware = failure.recovery.stage === undefined ? failure.withRecovery({ stage: recorder.lastCompleted() ?? 'preflight' }) : failure;
    recorder.stage('failed', stageAware.code);
    record.status = 'failed';
    record.error = { code: stageAware.code, recovery: stageAware.recovery, ...(stageAware.validation === undefined ? {} : { validation: stageAware.validation }) };
    dependencies.stderr(`${JSON.stringify(errorEnvelope(envelope, stageAware))}\n`);
    exitCode = exitCodeFor(stageAware.code);
  } finally {
    await release?.();
    record.endedAt = new Date().toISOString();
    record.exitCode = exitCode;
    if (persist) {
      try {
        await writeRunRecord(record, state);
        await pruneRunRecords(state);
      } catch {
        // A failed private record must never change the outcome of the operation.
      }
    }
  }
  return exitCode;
}
