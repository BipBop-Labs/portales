import { describe, expect, it } from 'vitest';
import { PortalError } from '../src/errors.js';
import { requireExactDiscoveredOption } from '../src/portal/selection.js';

describe('exact discovered selection', () => {
  const options = [
    { id: 'account-synthetic-a', label: 'Cuenta Sintética' },
    { id: 'account-synthetic-b', label: 'Cuenta Sintética' },
  ];

  it('stops when a label is ambiguous', () => {
    expect(() => requireExactDiscoveredOption(options, 'Cuenta Sintética')).toThrow(PortalError);
    try {
      requireExactDiscoveredOption(options, 'Cuenta Sintética');
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: 'REMOTE_STATE_AMBIGUOUS' });
    }
  });

  it('selects only an exact discovered machine ID', () => {
    expect(requireExactDiscoveredOption(options, 'account-synthetic-b')).toEqual(options[1]);
  });
});
