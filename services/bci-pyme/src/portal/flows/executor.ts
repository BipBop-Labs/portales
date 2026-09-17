import type { Frame, Page } from 'playwright';
import type { FlowStep } from '../../../../../packages/runtime/src/contracts.js';
import { PortalError } from '../../../../../packages/runtime/src/errors.js';
import { controlLocator, requireBciPageState } from '../page-state.js';

/** What a step list may touch. Destinations and readers are named so no step carries a raw URL or selector the contract does not already record. */
export interface FlowBindings {
  page: Page;
  operation: string;
  profile?: string;
  destinations: Record<string, string>;
  /** Named readers return JSON-serializable data; parsing stays in the adapter. */
  readers: Record<string, (scope: Page | Frame) => Promise<unknown>>;
  /** Private values for `fill` steps, resolved by key and never logged. */
  privateInputs?: Record<string, string>;
  /** Index for `click` with `index: 'selected'`. */
  selectedIndex?: number;
  waitForFrame: (fragment: string, timeoutMs?: number) => Promise<Frame>;
  onStage?: (stage: 'navigate' | 'parse' | 'download') => void;
}

export interface FlowResult {
  reads: Record<string, unknown>;
  frames: Record<string, Frame>;
  stoppedAt: string | null;
}

/** Interprets a contract step list deterministically. Unknown steps and missing bindings fail closed. */
export async function runFlow(steps: readonly FlowStep[], bindings: FlowBindings, options: { stopBefore?: FlowStep['step'] } = {}): Promise<FlowResult> {
  const result: FlowResult = { reads: {}, frames: {}, stoppedAt: null };
  let scope: Page | Frame = bindings.page;
  for (const step of steps) {
    if (options.stopBefore !== undefined && step.step === options.stopBefore) { result.stoppedAt = step.step; return result; }
    switch (step.step) {
      case 'goto': {
        const url = bindings.destinations[step.destination];
        if (url === undefined) throw new PortalError('INTERNAL', `Flow destination ${step.destination} is not bound.`);
        bindings.onStage?.('navigate');
        await bindings.page.goto(url, { waitUntil: 'domcontentloaded' });
        scope = bindings.page;
        break;
      }
      case 'expect-state':
        await requireBciPageState(bindings.page, bindings.operation, step.state, { ...(bindings.profile === undefined ? {} : { profile: bindings.profile }) });
        break;
      case 'expect-frame':
        scope = await bindings.waitForFrame(step.frame, step.timeoutMs);
        result.frames[step.frame] = scope;
        break;
      case 'click': {
        const target = step.frame === undefined ? scope : result.frames[step.frame] ?? await bindings.waitForFrame(step.frame);
        const locator = controlLocator(target, step);
        const index = step.index === 'selected' ? bindings.selectedIndex : step.index;
        if (step.index === 'selected' && index === undefined) throw new PortalError('INTERNAL', 'Flow click requires a selected index.');
        const chosen = index === undefined ? locator.first() : locator.nth(index);
        await chosen.waitFor({ state: 'visible', timeout: 30_000 });
        await chosen.click();
        break;
      }
      case 'fill': {
        const value = bindings.privateInputs?.[step.from];
        if (value === undefined) throw new PortalError('INTERNAL', `Flow fill input ${step.from} is not bound.`);
        const control = controlLocator(scope, step);
        await control.click();
        await control.pressSequentially(value);
        break;
      }
      case 'read': {
        const reader = bindings.readers[step.what];
        if (reader === undefined) throw new PortalError('INTERNAL', `Flow reader ${step.what} is not bound.`);
        bindings.onStage?.('parse');
        result.reads[step.what] = await reader(scope);
        break;
      }
      case 'expect-download':
        // The download event is awaited by the adapter together with the triggering click; the step marks the boundary.
        bindings.onStage?.('download');
        break;
      case 'stop':
        result.stoppedAt = step.reason;
        return result;
    }
  }
  return result;
}
