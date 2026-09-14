import { PortalError } from '../errors.js';

export interface DiscoveredOption {
  id: string;
  label: string;
}

export function requireExactDiscoveredOption<T extends DiscoveredOption>(
  options: readonly T[],
  requestedId: string,
): T {
  const exactIdMatches = options.filter(({ id }) => id === requestedId);
  const exactIdMatch = exactIdMatches[0];
  if (exactIdMatches.length === 1 && exactIdMatch !== undefined) return exactIdMatch;

  const labelMatches = options.filter(({ label }) => label === requestedId);
  if (labelMatches.length > 1) {
    throw new PortalError(
      'REMOTE_STATE_AMBIGUOUS',
      'The requested label identifies more than one portal option; use an exact discovered ID.',
    );
  }
  throw new PortalError(
    'INVALID_INPUT',
    'The requested ID was not returned by the corresponding options command.',
  );
}
