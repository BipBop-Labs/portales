#!/usr/bin/env node
import { runCli } from './cli.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SecretToolReader } from '../../../packages/runtime/src/secret-service.js';
import { LoginBreaker } from '../../../services/bci-pyme/src/auth/login-breaker.js';
import { PlaywrightBciLoginPortal, PlaywrightBciPymePortal } from '../../../services/bci-pyme/src/portal/playwright-portal.js';
import { loginBciPyme } from '../../../services/bci-pyme/src/tasks/auth-login.js';
import { loginSiiWithPortalesProfile } from './sii-auth.js';
import { runSiiDependency } from './sii-dependency.js';

const args = process.argv.slice(2);
const stateRoot = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
process.exitCode = await runCli(args, {
  openSessionPortal: (profile) => PlaywrightBciPymePortal.open(profile),
  loginSii: (input) => loginSiiWithPortalesProfile(input, { secrets: new SecretToolReader() }),
  runSii: runSiiDependency,
  login: (input) => loginBciPyme(input, {
    secrets: new SecretToolReader(),
    breaker: new LoginBreaker(stateRoot),
    portal: new PlaywrightBciLoginPortal(input.profile),
  }),
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
});
