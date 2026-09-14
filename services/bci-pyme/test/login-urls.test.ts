import { describe, expect, it } from 'vitest';
import {
  authenticatedShellUrl,
  deviceOmitName,
  isAuthenticatedLocation,
  publicLoginUrl,
} from '../src/portal/playwright-portal.js';

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
    )).toBe(true);
    expect(isAuthenticatedLocation('https://bel.bci.cl/LoginJSFGenerico', [
      'https://oss.bci.cl/fe-oss-shell-layout/',
    ], 0)).toBe(false);
    expect(isAuthenticatedLocation(authenticatedShellUrl, [
      'https://oss.bci.cl/fe-oss-shell-dashboard/',
    ], 0)).toBe(true);
  });
});
