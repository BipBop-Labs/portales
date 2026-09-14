#!/usr/bin/env node
import { runCli } from './cli.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SecretToolReader } from '../../../packages/runtime/src/secret-service.js';
import { LoginBreaker } from '../../../services/bci-pyme/src/auth/login-breaker.js';
import { PlaywrightBciLoginPortal, PlaywrightBciPymePortal } from '../../../services/bci-pyme/src/portal/playwright-portal.js';
import { loginBciPyme } from '../../../services/bci-pyme/src/tasks/auth-login.js';
import { loginSiiWithPortalesProfile } from './sii-auth.js';
import { runSiiNative } from './sii-native.js';
import { runWithVirtualDisplayIfNeeded } from './display.js';

const args = process.argv.slice(2);
const stateRoot = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
const virtualDisplay = runWithVirtualDisplayIfNeeded(args);
if (virtualDisplay !== null) {
  process.exitCode = await virtualDisplay;
} else {
  process.exitCode = await runCli(args, {
    openSessionPortal: (profile) => PlaywrightBciPymePortal.open(profile),
    loginSii: (input) => loginSiiWithPortalesProfile(input, { secrets: new SecretToolReader() }),
    runSii: (siiArgs) => runSiiNative(siiArgs, {
      stdout: (value) => process.stdout.write(value),
    }),
    login: (input) => loginBciPyme(input, {
      secrets: new SecretToolReader(),
      breaker: new LoginBreaker(stateRoot),
      portal: new PlaywrightBciLoginPortal(input.profile, () => {
        process.stderr.write('{"status":"WAITING_FOR_PHONE_APPROVAL"}\n');
      }),
    }),
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  });
}
