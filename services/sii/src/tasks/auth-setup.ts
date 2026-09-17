import { spawn } from 'node:child_process';
import { emitKeypressEvents } from 'node:readline';
import { PortalError } from '../../../../packages/runtime/src/errors.js';
import { isSafeName } from '../../../../packages/runtime/src/paths.js';
import { Rut } from '../rut/index.js';

export const SII_KEYRING_SERVICE = 'cl.bipbop.portales.sii';

/** Interactive enrollment only; ordinary tasks retain read-only keyring access. */
function readHidden(prompt: string): Promise<string> {
  const input = process.stdin;
  process.stderr.write(prompt);
  const wasRaw = input.isRaw;
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      input.off('keypress', onKey);
      input.off('end', onEnd);
      input.off('error', onEnd);
      input.setRawMode(wasRaw);
      input.pause();
      process.stderr.write('\n');
    };
    const onEnd = () => {
      value = '';
      cleanup();
      reject(new PortalError('INVALID_INPUT', 'Credential setup was cancelled.'));
    };
    const onKey = (text: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }) => {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) {
        onEnd();
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolve(value);
        value = '';
      } else if (key.name === 'backspace') {
        value = value.replace(/.$/u, '');
      } else if (!key.ctrl && !key.meta && text && !/[\p{Cc}\p{Cf}]/u.test(text)) {
        if (value.length + text.length > 1024) onEnd();
        else value += text;
      }
    };
    input.on('keypress', onKey);
    input.once('end', onEnd);
    input.once('error', onEnd);
  });
}

/** Stores `{version:1, rut, clave}` under (cl.bipbop.portales.sii, <profile>). Never authenticates. */
export async function setupSii(input: { profile: string }): Promise<{ configured: true; profile: string }> {
  if (!isSafeName(input.profile)) throw new PortalError('INVALID_INPUT', 'profile must be a safe local name of at most 64 characters.');
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new PortalError('INVALID_INPUT', 'auth setup requires an interactive terminal with hidden input.');
  }
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
    await new Promise<void>((resolve, reject) => {
      const child = spawn('secret-tool', [
        'store', '--label=Portales SII', 'service', SII_KEYRING_SERVICE, 'account', input.profile,
      ], { stdio: ['pipe', 'ignore', 'ignore'] });
      const fail = () => { reject(new PortalError('KEYRING_UNAVAILABLE', 'Credentials could not be stored in Secret Service.')); };
      child.once('error', fail);
      child.stdin.once('error', fail);
      child.once('close', (code) => { if (code === 0) resolve(); else fail(); });
      child.stdin.end(encoded);
    });
    return { configured: true, profile: input.profile };
  } finally {
    rut = '';
    clave = '';
    encoded = '';
  }
}
