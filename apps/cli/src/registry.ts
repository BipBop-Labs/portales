import type { Registry } from '../../../packages/runtime/src/registry.js';
import type { CliDependencies } from './dependencies.js';
import { bciPymeService } from './commands/bci-pyme.js';
import { bci_pyme_observeCommands } from './commands/bci-pyme-observe.js';
import { sagService } from './commands/sag.js';
import { siiService } from './commands/sii.js';
import { globalCommands } from './commands/global.js';
import { doctorCommands } from './commands/doctor.js';
import { contractCommands } from './commands/contract.js';

/** One registration line per service. Help, catalog, describe, and dispatch derive from this. */
export function buildRegistry(): Registry<CliDependencies> {
  const registry: Registry<CliDependencies> = {
    services: [
      { ...bciPymeService, commands: [...bciPymeService.commands, ...bci_pyme_observeCommands] },
      sagService,
      siiService,
    ],
    globals: [],
  };
  (registry as { globals: Registry<CliDependencies>['globals'] }).globals = [...globalCommands(() => registry), ...doctorCommands, ...contractCommands];
  return registry;
}
