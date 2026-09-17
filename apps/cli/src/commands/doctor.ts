import { invalidInput } from '../../../../packages/runtime/src/errors.js';
import { defaultProbes, isDoctorService, runDoctor } from '../../../../packages/runtime/src/doctor.js';
import type { CommandSpec } from '../../../../packages/runtime/src/registry.js';
import type { CliDependencies } from '../dependencies.js';

export const doctorCommands: CommandSpec<CliDependencies>[] = [
  {
    service: 'portales', path: ['doctor'], summary: 'Local readiness checks: build, browser, Xvfb, pdftotext, keyring, permissions, sessions, breakers, locks.',
    description: 'Never authenticates or contacts a portal. Live verification belongs to portales <service> verify --live.',
    effect: 'read', auth: 'public', browser: 'none', profile: 'optional',
    positionals: [{ name: 'service', kind: 'enum', values: ['bci-pyme', 'sag', 'sii'], required: false, description: 'Limit checks to one service.' }],
    output: { description: '{ service, profile, status: ok|warn|fail, browserMode, live: false, checks: [{ name, status, detail, nextAction? }] }' },
    errors: ['INVALID_INPUT'],
    run(input, context) {
      const service = input.positionals.service;
      if (service !== undefined && !isDoctorService(service)) {
        throw invalidInput('Unknown service.', [{ field: '<service>', expected: 'bci-pyme, sag, or sii' }]);
      }
      return runDoctor({ ...(service === undefined ? {} : { service }), profile: input.profile ?? 'default' }, context.deps.doctorProbes ?? defaultProbes(context.env));
    },
  },
];
