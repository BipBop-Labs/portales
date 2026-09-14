import { spawn } from 'node:child_process';

export interface SecretAttributes {
  service: string;
  account: string;
}

export interface SecretReader {
  read(attributes: SecretAttributes): Promise<string>;
}

interface InvocationResult { stdout: Buffer; exitCode: number | null }
type Invoke = (
  command: string,
  args: string[],
  options: { stdio: ['ignore', 'pipe', 'pipe'] },
) => Promise<InvocationResult>;

const invokeCaptured: Invoke = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, options);
  const chunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => { chunks.push(chunk); });
  // Drain diagnostics without retaining them: Secret Service messages are not public output.
  child.stderr.resume();
  child.once('error', reject);
  child.once('close', (exitCode) => { resolve({ stdout: Buffer.concat(chunks), exitCode }); });
});

export class SecretServiceError extends Error {
  constructor(readonly code: 'CREDENTIALS_NOT_CONFIGURED' | 'KEYRING_UNAVAILABLE') {
    super('Secret Service lookup failed.');
  }
}

export class SecretToolReader implements SecretReader {
  constructor(private readonly invoke: Invoke = invokeCaptured) {}

  async read(attributes: SecretAttributes): Promise<string> {
    let result: InvocationResult;
    try {
      result = await this.invoke('secret-tool', [
        'lookup', 'service', attributes.service, 'account', attributes.account,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      throw new SecretServiceError('KEYRING_UNAVAILABLE');
    }
    if (result.exitCode !== 0 || result.stdout.length === 0) {
      throw new SecretServiceError('CREDENTIALS_NOT_CONFIGURED');
    }
    return result.stdout.toString('utf8').replace(/\r?\n$/u, '');
  }
}
