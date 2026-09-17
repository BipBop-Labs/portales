import type { Stage } from './errors.js';
import type { BrowserMode } from './browser-mode.js';

export const SCHEMA_VERSION = '1';

/** Lifecycle event written to STDERR as one JSON line. Allowlisted fields only. */
export interface LifecycleEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  runId: string;
  service: string;
  operation: string;
  stage: Stage;
  at: string;
  /** Milliseconds since the run started. */
  elapsedMs: number;
  browserMode?: BrowserMode;
  /** Static detail token, never portal text. */
  detail?: string;
}

export interface StageTiming {
  stage: Stage;
  at: string;
  elapsedMs: number;
  detail?: string;
}

export interface StageRecorder {
  /** Emits the stage event and remembers it for the run record. */
  stage(stage: Stage, detail?: string): void;
  readonly timings: readonly StageTiming[];
  lastCompleted(): Stage | undefined;
}

export function createStageRecorder(input: {
  runId: string;
  service: string;
  operation: string;
  browserMode: BrowserMode;
  startedAt: number;
  write: (line: string) => void;
  now?: () => number;
}): StageRecorder {
  const timings: StageTiming[] = [];
  const now = input.now ?? Date.now;
  return {
    timings,
    stage(stage, detail) {
      const at = new Date(now()).toISOString();
      const elapsedMs = now() - input.startedAt;
      const timing: StageTiming = { stage, at, elapsedMs, ...(detail === undefined ? {} : { detail }) };
      timings.push(timing);
      const event: LifecycleEvent = {
        schemaVersion: SCHEMA_VERSION,
        runId: input.runId,
        service: input.service,
        operation: input.operation,
        stage,
        at,
        elapsedMs,
        browserMode: input.browserMode,
        ...(detail === undefined ? {} : { detail }),
      };
      input.write(`${JSON.stringify(event)}\n`);
    },
    lastCompleted() {
      const completed = timings.filter((item) => item.stage !== 'failed' && item.stage !== 'completed');
      return completed.at(-1)?.stage;
    },
  };
}
