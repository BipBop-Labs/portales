#!/usr/bin/env node
import { runCli } from './cli.js';
import { SecretToolReader } from '../../../packages/runtime/src/secret-service.js';
import { stateRoot } from '../../../packages/runtime/src/paths.js';
import { findCommand } from '../../../packages/runtime/src/registry.js';
import { readVersionInfo } from '../../../packages/runtime/src/version.js';
import { AuthState, LoginBreaker } from '../../../services/bci-pyme/src/auth/login-breaker.js';
import { PlaywrightBciLoginPortal, PlaywrightBciPymePortal } from '../../../services/bci-pyme/src/portal/playwright-portal.js';
import { setupBciPyme } from '../../../services/bci-pyme/src/tasks/auth-setup.js';
import { loginBciPyme } from '../../../services/bci-pyme/src/tasks/auth-login.js';
import { loginSiiWithPortalesProfile } from './sii-auth.js';
import { setupSii } from '../../../services/sii/src/tasks/auth-setup.js';
import { runWithVirtualDisplayIfNeeded } from './display.js';
import { buildRegistry } from './registry.js';

const args = process.argv.slice(2);
const registry = buildRegistry();
const found = args.includes('--help') ? undefined : findCommand(registry, args);
const virtualDisplay = found?.spec.browser === 'headed' ? runWithVirtualDisplayIfNeeded(args) : null;
if (virtualDisplay !== null) {
  process.exitCode = await virtualDisplay;
} else {
  const version = await readVersionInfo().catch(() => undefined);
  process.exitCode = await runCli(args, {
    registry,
    setup: setupBciPyme,
    openSessionPortal: (profile) => PlaywrightBciPymePortal.open(profile),
    loginSii: (input) => loginSiiWithPortalesProfile(input, { secrets: new SecretToolReader() }),
    setupSii,
    login: (input) => loginBciPyme(input, {
      secrets: new SecretToolReader(),
      breaker: new LoginBreaker(stateRoot()),
      authState: new AuthState(stateRoot()),
      portal: new PlaywrightBciLoginPortal(input.profile),
    }),
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
    ...(version === undefined ? {} : { packageVersion: version.packageVersion, ...(version.commit === null ? {} : { commit: version.commit }) }),
  });
}
