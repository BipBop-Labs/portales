// Runs after `tsc -b`: records what was built so `portales version` and `doctor` can detect a stale build.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
let commit = null;
try {
  commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  commit = null;
}
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'build-info.json'), `${JSON.stringify({ version: pkg.version ?? '0.0.0', commit, builtAt: new Date().toISOString(), node: process.version, builtBy: 'npm run build' })}\n`);
