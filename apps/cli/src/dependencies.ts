import type { BciPymePortal } from '../../../services/bci-pyme/src/portal/types.js';
import type { Registry } from '../../../packages/runtime/src/registry.js';
import type { DoctorProbes } from '../../../packages/runtime/src/doctor.js';

/** Everything the composition root injects; tests replace the portal-facing members. */
export interface CliDependencies {
  openSessionPortal(profile: string): Promise<BciPymePortal & { close?: () => Promise<void> }>;
  setup?: (input: { profile: string }) => Promise<unknown>;
  login(input: { profile: string }): Promise<unknown>;
  loginSii?: (input: { profile: string }) => Promise<unknown>;
  /** @deprecated No longer used; SII commands are registry-parsed. Kept so older test literals still type-check. */
  runSii?: (args: string[]) => Promise<number>;
  setupSii?: (input: { profile: string }) => Promise<unknown>;
  /** Test seam: builds the SII runtime for a profile (defaults to the Node composition root). */
  createSiiRuntime?: (profile: string) => import('../../../services/sii/src/seams/index.js').Runtime;
  stdout(value: string): void;
  stderr(value: string): void;
  registry?: Registry<CliDependencies>;
  env?: NodeJS.ProcessEnv;
  stateRoot?: string;
  dataRoot?: string;
  packageVersion?: string;
  commit?: string;
  /** Test seam for portales doctor; defaults to local probes. */
  doctorProbes?: DoctorProbes;
}
