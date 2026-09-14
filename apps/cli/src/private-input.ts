import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { PortalError } from '../../../services/bci-pyme/src/errors.js';

/** Both banking selections and traveler details must come from private regular files. */
export async function readPrivateJson(path: string): Promise<unknown> {
  let input;
  try {
    input = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const inputStat = await input.stat();
    if (!inputStat.isFile() || (inputStat.mode & 0o077) !== 0) {
      throw new PortalError('INVALID_INPUT', 'The input must be a private regular file without group or other permissions.');
    }
    return JSON.parse(await input.readFile('utf8')) as unknown;
  } catch (error: unknown) {
    if (error instanceof PortalError) throw error;
    if (error instanceof SyntaxError) {
      throw new PortalError('INVALID_INPUT', 'The input file must contain valid JSON.');
    }
    throw new PortalError('INVALID_INPUT', 'The private input file could not be opened safely.');
  } finally {
    await input?.close();
  }
}
