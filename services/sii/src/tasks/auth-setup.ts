import { readHidden, requireInteractiveTerminal, storeSecret } from '../../../../packages/runtime/src/secret-setup.js';
import { PortalError } from '../../../../packages/runtime/src/errors.js';
import { isSafeName } from '../../../../packages/runtime/src/paths.js';
import { Rut } from '../rut/index.js';

export const SII_KEYRING_SERVICE = 'cl.bipbop.portales.sii';

/** Interactive enrollment only; ordinary tasks retain read-only keyring access.
 *  Stores `{version:1, rut, clave}` under (cl.bipbop.portales.sii, <profile>). Never authenticates. */
export async function setupSii(input: { profile: string }): Promise<{ configured: true; profile: string }> {
  if (!isSafeName(input.profile)) throw new PortalError('INVALID_INPUT', 'profile must be a safe local name of at most 64 characters.');
  requireInteractiveTerminal();
  let rut = '';
  let clave = '';
  let encoded = '';
  try {
    rut = await readHidden('RUT SII (entrada oculta): ');
    if (Rut.tryParse(rut) === null) throw new PortalError('CREDENTIALS_INVALID', 'The RUT is not valid.');
    clave = await readHidden('Clave Tributaria (entrada oculta): ');
    if (clave.length === 0) throw new PortalError('CREDENTIALS_INVALID', 'The clave must not be empty.');
    encoded = JSON.stringify({ version: 1, rut: Rut.parse(rut).canonical, clave });
    const confirmation = await readHidden(`Guardar o reemplazar credenciales SII del perfil ${input.profile}: escribe guardar: `);
    if (confirmation !== 'guardar') throw new PortalError('INVALID_INPUT', 'Credential setup was cancelled.');
    await storeSecret({ service: SII_KEYRING_SERVICE, account: input.profile, label: 'Portales SII', encoded });
    return { configured: true, profile: input.profile };
  } finally {
    rut = '';
    clave = '';
    encoded = '';
  }
}
