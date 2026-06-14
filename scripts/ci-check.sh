#!/usr/bin/env bash
# Full local CI parity — same gates as CONTRIBUTING.md recommends.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

echo "==> pnpm build"
pnpm build

echo "==> pnpm typecheck"
pnpm typecheck

echo "==> pnpm lint"
pnpm lint

echo "==> pnpm test:unit"
pnpm test:unit

echo "==> pnpm size:check"
pnpm size:check

echo "==> pnpm test:e2e"
GUIDEKIT_SECRET="${GUIDEKIT_SECRET:-guidekit-example-e2e-secret-32-chars}" \
LLM_API_KEY="${LLM_API_KEY:-e2e-dummy-llm-key-for-contract-tests}" \
pnpm test:e2e

echo ""
echo "All checks passed."
