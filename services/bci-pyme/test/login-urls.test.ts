import { describe, expect, it } from 'vitest';
import {
  authenticatedShellUrl,
  deviceOmitName,
  isAuthenticatedLocation,
  isExpiredSessionLocation,
  publicLoginUrl,
  shouldProbeAuthenticatedSession,
  submitObservedLogin,
} from '../src/portal/playwright-portal.js';
import { vi } from 'vitest';

describe('BCI navigation boundaries', () => {
  it('keeps explicit login and session commands on different documented entries', () => {
    expect(publicLoginUrl).toBe('https://www.bci.cl/corporativo/banco-en-linea/pyme');
    expect(authenticatedShellUrl).toBe('https://bel.bci.cl/cl/bci/aplicaciones/contenidoLayoutOSSPyme.jsf');
  });

  it('recognizes both observed non-enrollment labels', () => {
    expect(deviceOmitName.test('Omitir')).toBe(true);
    expect(deviceOmitName.test('Omitir por ahora')).toBe(true);
    expect(deviceOmitName.test('Ir a registrar')).toBe(false);
  });

  it('requires an authenticated destination rather than a bare layout frame', () => {
    expect(isAuthenticatedLocation(
      'https://bel.bci.cl/cl/bci/aplicaciones/seguridad/autenticacion/vista/vistaSelectorConvenio.jsf',
      [],
      0,
      1,
    )).toBe(true);
    expect(isAuthenticatedLocation('https://bel.bci.cl/LoginJSFGenerico', [
      'https://oss.bci.cl/fe-oss-shell-layout/',
    ], 0, 0)).toBe(false);
    expect(isAuthenticatedLocation(authenticatedShellUrl, [
      'https://oss.bci.cl/fe-oss-shell-dashboard/',
    ], 0, 0)).toBe(true);
  });

  it('does not accept a selector URL serving a system-error page without business rows', () => {
    expect(isAuthenticatedLocation(
      'https://synthetic.invalid/vistaSelectorConvenio.jsf', [], 0, 0,
    )).toBe(false);
  });

  it('classifies the documented no-session route as an expired session', () => {
    expect(isExpiredSessionLocation(
      'https://synthetic.invalid/cl/bci/aplicaciones/seguridad/loginNoSesion.jsf',
    )).toBe(true);
    expect(isExpiredSessionLocation(authenticatedShellUrl)).toBe(false);
  });

  it('submits the observed native form through one Playwright click', async () => {
    const click = vi.fn().mockResolvedValue(undefined);

    await submitObservedLogin({ click });

    expect(click).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledWith();
  });

  it('probes the business selector once when login ends on the relay', () => {
    expect(shouldProbeAuthenticatedSession('https://bel.bci.cl/LoginJSFGenerico', false)).toBe(true);
    expect(shouldProbeAuthenticatedSession('https://bel.bci.cl/LoginJSFGenerico', true)).toBe(false);
    expect(shouldProbeAuthenticatedSession(publicLoginUrl, false)).toBe(false);
  });

});
