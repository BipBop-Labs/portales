import { type Contract, type ContractControl, type ContractPageState, controlLabel, countMatches, expectedCountText } from './contracts.js';
export type { ContractControl };

export type PageStateKind = 'login-page' | 'authenticated-shell' | 'provider-error' | 'empty-valid-result' | 'loading' | 'blocked' | 'changed' | 'result';

/** Bounded, allowlisted description of a live page. Never text content beyond matched markers. */
export interface PageDescription {
  /** Path only; query strings are stripped by the describer. */
  routePath: string;
  frameNames: string[];
  /** Visible counts for the controls the contract asks about, keyed by `controlKey`. */
  controlCounts: Record<string, number>;
  /** Static marker tokens that were found (e.g. 'blocked', 'captcha', 'provider-error', 'loading'). */
  markers: string[];
}

export interface Classification {
  kind: PageStateKind;
  /** Contract page state name when one matched. */
  state: string | null;
  /** Smallest structural differences against the closest expected state. */
  diff: string[];
}

export function controlKey(item: { role?: string | undefined; name?: string | undefined; css?: string | undefined; text?: string | undefined }): string {
  return controlLabel(item);
}

function routeMatches(state: ContractPageState, routePath: string): boolean {
  return state.routeFragments.length === 0 || state.routeFragments.some((fragment) => routePath.includes(fragment));
}

function frameMatches(state: ContractPageState, frames: string[]): boolean {
  return state.frameNames.every((name) => frames.some((frame) => frame.includes(name)));
}

function controlDiff(state: ContractPageState, description: PageDescription): string[] {
  const diff: string[] = [];
  for (const item of state.controls) {
    const observed = description.controlCounts[controlKey(item)] ?? 0;
    if (!countMatches(item.expectedVisibleCount, observed)) {
      diff.push(`expected ${expectedCountText(item.expectedVisibleCount)} visible ${controlLabel(item)}, observed ${String(observed)}`);
    }
  }
  return diff;
}

/** Classifies a described page against the contract's page states before any parsing. */
export function classifyPage(contract: Pick<Contract, 'pageStates'>, description: PageDescription, options: { candidates?: string[] } = {}): Classification {
  if (description.markers.includes('blocked')) return { kind: 'blocked', state: null, diff: [] };
  if (description.markers.includes('provider-error')) return { kind: 'provider-error', state: null, diff: [] };
  if (description.markers.includes('loading')) return { kind: 'loading', state: null, diff: [] };
  const names = options.candidates ?? Object.keys(contract.pageStates);
  let closest: { state: string; diff: string[]; kind: PageStateKind } | undefined;
  for (const name of names) {
    const state = contract.pageStates[name];
    if (state === undefined) continue;
    const kind: PageStateKind = state.kind;
    const route = routeMatches(state, description.routePath);
    const frames = frameMatches(state, description.frameNames);
    const diff = controlDiff(state, description);
    if (!route) diff.unshift(`expected route containing ${state.routeFragments.join(' | ')}, observed ${description.routePath || '(none)'}`);
    if (!frames) diff.unshift(`expected frames ${state.frameNames.join(', ')}, observed ${description.frameNames.join(', ') || '(none)'}`);
    if (diff.length === 0) return { kind, state: name, diff: [] };
    if (closest === undefined || diff.length < closest.diff.length) closest = { state: name, diff, kind };
  }
  if (closest === undefined) return { kind: 'changed', state: null, diff: ['no page state is declared for this operation'] };
  return { kind: 'changed', state: closest.state, diff: closest.diff };
}
