#!/usr/bin/env sh
# Reproducible local installation: dependencies, build, and one `portales` executable on PATH.
# Re-run after `git pull`, or use `npm run update` (git pull --ff-only && npm ci && npm run build).
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
npm ci --include=dev
npm run build
bin_dir="${PORTALES_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$bin_dir"
ln -sfn "$root/dist/apps/cli/src/main.js" "$bin_dir/portales"
chmod +x "$root/dist/apps/cli/src/main.js"
echo "portales installed at $bin_dir/portales (make sure $bin_dir is on PATH)"
node "$root/dist/apps/cli/src/main.js" version --json
