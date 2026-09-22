import type { Frame, Locator, Page } from 'playwright';
import { type Contract, type ContractPageState, controlLabel, loadContract } from '../../../../packages/runtime/src/contracts.js';
import { PortalError } from '../../../../packages/runtime/src/errors.js';
import { type Classification, type PageDescription, classifyPage } from '../../../../packages/runtime/src/page-state.js';
import { sanitizeRoute } from '../../../../packages/runtime/src/observation.js';
import { repositoryRoot } from '../../../../packages/runtime/src/version.js';

/** Static text markers observed on BCI pages. Matching only, never captured. */
const blockedPatterns = [/captcha|turnstile|c[oó]digo.*(seguridad|verificaci[oó]n)|segundo factor/iu, /cuenta.*bloquead|acceso.*bloquead/iu, /demasiados intentos|intenta m[aá]s tarde/iu];
const providerErrorText = 'Algo salió mal';

type Scope = Page | Frame;

/** Selector facts a contract may record for one control. */
export type ControlSelector = { role?: string | undefined; name?: string | undefined; exact?: boolean | undefined; css?: string | undefined; text?: string | undefined };

export function controlLocator(scope: Scope, item: ControlSelector): Locator {
  if (item.role !== undefined) {
    const role = item.role as Parameters<Scope['getByRole']>[0];
    // `exact: false` is a recorded contract fact (icon glyph inside the accessible name), never a runtime fallback.
    return item.name === undefined ? scope.getByRole(role) : scope.getByRole(role, { name: item.name, exact: item.exact ?? true });
  }
  if (item.text !== undefined) return scope.getByText(item.text, { exact: true });
  return scope.locator(item.css ?? ':not(*)');
}

async function visibleCount(scope: Scope, item: ControlSelector): Promise<number> {
  let count = 0;
  for (const candidate of await controlLocator(scope, item).all()) {
    if (await candidate.isVisible()) count++;
  }
  return count;
}

/** Counts a control across the page and every frame, so frame relocation shows up as a diff rather than a silent miss. */
export async function countAcrossFrames(page: Page, item: ControlSelector): Promise<number> {
  let total = 0;
  for (const frame of page.frames()) total += await visibleCount(frame, item);
  return total;
}

/** Bounded description of the current page for the controls one contract state cares about. */
export async function describeBciPage(page: Page, state: ContractPageState): Promise<PageDescription> {
  const markers: string[] = [];
  if (/vistaSelectorConvenio\.jsf/iu.test(page.url()) && await page.getByText(providerErrorText, { exact: true }).isVisible().catch(() => false)) markers.push('provider-error');
  for (const frame of page.frames()) {
    for (const pattern of blockedPatterns) {
      if (await frame.getByText(pattern).count().catch(() => 0) > 0) { markers.push('blocked'); break; }
    }
    if (markers.includes('blocked')) break;
  }
  if (/un momento|just a moment/iu.test(await page.title().catch(() => ''))) markers.push('blocked');
  const controlCounts: Record<string, number> = {};
  for (const item of state.controls) controlCounts[controlLabel(item)] = await countAcrossFrames(page, item);
  return {
    routePath: sanitizeRoute(page.url()),
    frameNames: page.frames().map((frame) => sanitizeRoute(frame.url())).filter((route) => route !== '/' && route !== ''),
    controlCounts,
    markers,
  };
}

let cached: Map<string, { path: string; contract: Contract } | null> | undefined;

/** Loads (and memoizes per process) the dated contract for a bci-pyme operation. */
export async function bciContract(operation: string): Promise<{ path: string; contract: Contract } | null> {
  cached ??= new Map();
  if (!cached.has(operation)) cached.set(operation, await loadContract(repositoryRoot(), 'bci-pyme', operation));
  return cached.get(operation) ?? null;
}

export function contractRefFor(loaded: { path: string } | null): string {
  return loaded === null ? 'services/bci-pyme/docs/contracts/read-only-browser-flow.md' : loaded.path.replace(/^.*?(services\/)/u, '$1');
}

/** Classifies the live page against one expected state and converts non-result states into typed errors. */
export async function requireBciPageState(page: Page, operation: string, expectedState: string, options: { profile?: string; stage?: 'session-check' | 'navigate' | 'parse' | 'download' | 'verify' } = {}): Promise<Classification> {
  const loaded = await bciContract(operation);
  if (loaded === null) throw new PortalError('INTERNAL', `No dated contract declares ${operation}; run portales contract validate.`);
  const state = loaded.contract.pageStates[expectedState];
  if (state === undefined) throw new PortalError('INTERNAL', `Contract for ${operation} declares no page state ${expectedState}.`);
  const description = await describeBciPage(page, state);
  const classification = classifyPage(loaded.contract, description, { candidates: [expectedState, ...Object.keys(loaded.contract.pageStates).filter((name) => name !== expectedState)] });
  const recovery = { stage: options.stage ?? 'navigate', contractRef: contractRefFor(loaded) } as const;
  switch (classification.kind) {
    case 'blocked':
      throw new PortalError('ACCOUNT_BLOCKED', 'The portal displayed a stop condition (block, additional verification, or rate limit).', { recovery: { ...recovery, nextAction: 'Stop. Requires human/provider resolution; do not retry or re-login.' } });
    case 'provider-error':
      // Observed 2026-09-22: BCI serves this page when the saved session is missing or expired.
      throw new PortalError('SESSION_EXPIRED', 'BCI served its system-error page, which it does when the saved session is missing or expired.', { recovery: { ...recovery, nextCommand: `portales bci-pyme auth login --profile ${options.profile ?? '<profile>'}`, nextAction: 'Run auth login explicitly once; if this page persists right after a successful login, check portal availability in a browser.' } });
    case 'login-page':
      throw new PortalError('SESSION_EXPIRED', 'The BCI session is not authenticated. Run auth login explicitly.', { recovery: { ...recovery, nextCommand: `portales bci-pyme auth login --profile ${options.profile ?? '<profile>'}` } });
    case 'loading':
      throw new PortalError('READINESS_TIMEOUT', `The ${expectedState} page state did not become ready.`, { recovery });
    case 'changed':
      throw new PortalError('CONTRACT_MISMATCH', `Contract mismatch in ${operation} at page state ${expectedState}: ${classification.diff[0] ?? 'structure differs'}.`, {
        recovery: { ...recovery, nextCommand: `portales bci-pyme observe ${operation} --profile ${options.profile ?? '<profile>'}`, nextAction: 'Do not broaden selectors or retry. Run observe, review the proposed contract diff, then repair the dated contract.' },
      });
    default:
      return classification;
  }
}
