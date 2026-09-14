import { spawn } from 'node:child_process';
import { emitKeypressEvents } from 'node:readline';
import { requireSafeProfile } from '../auth/login-breaker.js';
import { PortalError } from '../errors.js';
import { parseCredentials } from './auth-login.js';

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
        if (value.length + text.length > 1024) {
          onEnd();
        } else {
          value += text;
        }
      }
    };
    input.on('keypress', onKey);
    input.once('end', onEnd);
    input.once('error', onEnd);
  });
}

export async function setupBciPyme(input: { profile: string }) {
  requireSafeProfile(input.profile);
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new PortalError('INVALID_INPUT', 'auth setup requires an interactive terminal with hidden input.');
  }
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
    await new Promise<void>((resolve, reject) => {
      const child = spawn('secret-tool', [
        'store', '--label=Portales BCI', 'service', 'cl.bipbop.portales.bci', 'account', input.profile,
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
    password = '';
    encoded = '';
  }
}
