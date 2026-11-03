#!/usr/bin/env bash
# Deterministic fixture review only: no intake acquisition or database commands.
set -euo pipefail
cd "$(dirname "$0")/.."
./node_modules/.bin/vitest run \
  test/sources/lib/youtube \
  test/sources/lib/officer-mentions \
  test/sources/lib/rolling-window.test.ts \
  test/sources/youtube --maxWorkers=2
npm run typecheck
npm run build
npm run openspec:validate
