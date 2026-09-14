import { spawn as nodeSpawn } from 'node:child_process';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';

interface ChildHandle {
  pid?: number;
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

interface SignalSource {
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  off(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}

type Spawn = (
  command: string,
  args: string[],
  options: { stdio: 'inherit'; env: NodeJS.ProcessEnv; detached: true },
) => ChildHandle;

interface VirtualDisplayOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  executable?: string;
  entrypoint?: string;
  spawn?: Spawn;
  signalSource?: SignalSource;
  killProcessGroup?: (pid: number, signal: NodeJS.Signals) => unknown;
  stderr?: (value: string) => void;
}

/** Runs BCI in an invisible headed browser under Xvfb on Linux while keeping `portales` as the only public interface. */
export function runWithVirtualDisplayIfNeeded(
  args: string[],
  options: VirtualDisplayOptions = {},
): Promise<number> | null {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  if ((args[1] === 'auth' && args[2] === 'setup') || args[0] !== 'bci-pyme' || platform !== 'linux'
    || env.PORTALES_XVFB_ACTIVE === '1') return null;

  const spawn = options.spawn ?? nodeSpawn;
  const executable = options.executable ?? process.execPath;
  const entrypoint = options.entrypoint ?? fileURLToPath(import.meta.url).replace(/display\.js$/u, 'main.js');
  const child = spawn('xvfb-run', ['-a', executable, entrypoint, ...args], {
    stdio: 'inherit',
    env: { ...env, PORTALES_XVFB_ACTIVE: '1' },
    detached: true,
  });
  const signalSource = options.signalSource ?? process;
  const stderr = options.stderr ?? ((value: string) => process.stderr.write(value));
  const killProcessGroup = options.killProcessGroup ?? ((pid: number, signal: NodeJS.Signals) => (
    process.kill(pid, signal)
  ));
  const forward = (signal: 'SIGINT' | 'SIGTERM') => () => {
    if (child.pid === undefined) return;
    try {
      killProcessGroup(-child.pid, signal);
    } catch {
      // The child may have completed between signal delivery and forwarding.
    }
  };
  const forwardInterrupt = forward('SIGINT');
  const forwardTerminate = forward('SIGTERM');
  signalSource.on('SIGINT', forwardInterrupt);
  signalSource.on('SIGTERM', forwardTerminate);
  const cleanup = () => {
    signalSource.off('SIGINT', forwardInterrupt);
    signalSource.off('SIGTERM', forwardTerminate);
  };
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(code);
    };
    child.once('error', () => {
      stderr(`${JSON.stringify({ error: {
        code: 'PORTAL_CHANGED',
        message: 'The operation could not be completed safely.',
        retryable: false,
      } })}\n`);
      finish(7);
    });
    child.once('exit', (code, signal) => {
      finish(code ?? (signal ? 128 + constants.signals[signal] : 0));
    });
  });
}
