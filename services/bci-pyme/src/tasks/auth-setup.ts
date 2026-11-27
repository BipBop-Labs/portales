import { readHidden, requireInteractiveTerminal, storeSecret } from '../../../../packages/runtime/src/secret-setup.js';
import { requireSafeProfile } from '../auth/login-breaker.js';
import { PortalError } from '../errors.js';
import { parseCredentials } from './auth-login.js';

/** Interactive enrollment only; ordinary tasks retain read-only keyring access. */
export async function setupBciPyme(input: { profile: string }) {
  requireSafeProfile(input.profile);
  requireInteractiveTerminal();
  let rut = '';
  let password = '';
  let encoded = '';
  try {
    rut = await readHidden('RUT BCI (entrada oculta): ');
    password = await readHidden('Contraseña BCI (entrada oculta): ');
    encoded = JSON.stringify({ version: 1, rut, password });
    parseCredentials(encoded);
    const confirmation = await readHidden(`Guardar o reemplazar credenciales del perfil ${input.profile}: escribe guardar: `);
    if (confirmation !== 'guardar') {
      throw new PortalError('INVALID_INPUT', 'Credential setup was cancelled.');
    }
    await storeSecret({ service: 'cl.bipbop.portales.bci', account: input.profile, label: 'Portales BCI', encoded });
    return { configured: true, profile: input.profile };
  } finally {
    rut = '';
    password = '';
    encoded = '';
  }
}
