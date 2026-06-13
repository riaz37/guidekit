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

echo ""
echo "All checks passed."
