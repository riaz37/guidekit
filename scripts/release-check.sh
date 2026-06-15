#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> pnpm check"
pnpm check

echo "==> verify published packages"
node scripts/verify-published-packages.mjs

echo "==> CLI subprocess smoke"
pnpm test:unit -- packages/cli/src/cli.smoke.test.ts

echo "==> live E2E run 1"
LIVE_LLM=1 pnpm test:e2e:live:full

echo "==> live E2E run 2 (flake budget)"
LIVE_LLM=1 pnpm test:e2e:live:full

if [ "${SKIP_NPM_DRY_RUN:-}" = "1" ]; then
  echo "==> npm dry-run skipped (SKIP_NPM_DRY_RUN=1)"
else
  if [ -n "${NODE_AUTH_TOKEN:-}" ] || [ -n "${NPM_TOKEN:-}" ]; then
    echo "==> npm publish dry-run"
    pnpm publish:packages:dry-run
  else
    echo "==> npm publish dry-run skipped (no token)"
  fi
fi

echo ""
echo "Release checks passed."

