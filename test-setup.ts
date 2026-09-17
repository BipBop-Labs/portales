// Keep run records, locks, and artifact indexes out of the real home directory during tests.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'portales-test-state-'));
process.env.XDG_STATE_HOME = join(root, 'state');
process.env.XDG_DATA_HOME = join(root, 'data');
process.env.XDG_CONFIG_HOME = join(root, 'config');
