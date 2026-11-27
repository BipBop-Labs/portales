import { spawn } from 'node:child_process';
import { emitKeypressEvents } from 'node:readline';
import { PortalError } from './errors.js';

/** Interactive credential enrollment shared by every keyring-backed service. Ordinary tasks keep
 *  read-only keyring access; only `auth setup` commands import this module. */

/** Rejects setup unless both STDIN and STDERR are a terminal, so no pipe can supply a secret. */
export function requireInteractiveTerminal(): void {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new PortalError('INVALID_INPUT', 'auth setup requires an interactive terminal with hidden input.');
  }
}

/** Reads one line with terminal echo disabled; the prompt goes to STDERR. */
export function readHidden(prompt: string): Promise<string> {
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

/** Stores or replaces the exact (service, account) Secret Service item. The bundle goes to
 *  `secret-tool` through its STDIN, never through arguments. */
export function storeSecret(item: { service: string; account: string; label: string; encoded: string }): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('secret-tool', [
      'store', `--label=${item.label}`, 'service', item.service, 'account', item.account,
    ], { stdio: ['pipe', 'ignore', 'ignore'] });
    const fail = () => { reject(new PortalError('KEYRING_UNAVAILABLE', 'Credentials could not be stored in Secret Service.')); };
    child.once('error', fail);
    child.stdin.once('error', fail);
    child.once('close', (code) => { if (code === 0) resolve(); else fail(); });
    child.stdin.end(item.encoded);
  });
}
