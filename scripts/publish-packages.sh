#!/usr/bin/env bash
# Publish all @guidekit/* packages to npm (RemotionUI-style local release script).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help)
      echo "Usage: bash scripts/publish-packages.sh [--dry-run]"
      echo ""
      echo "Builds all packages and publishes @guidekit/* to npm."
      echo "Prefer GitHub Actions (Publish Packages workflow) for regular releases."
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if [ -f "$ROOT/.env" ]; then
  echo "Loading NPM_TOKEN from .env (legacy local fallback)."
  echo "Prefer GitHub Actions Trusted Publishing with npm OIDC for releases."
  set -a
  # shellcheck source=/dev/null
  source "$ROOT/.env"
  set +a
fi

if [ -z "${NPM_TOKEN:-}" ]; then
  echo "NPM_TOKEN is not set; using the current npm CLI authentication (~/.npmrc)."
  echo "Prefer GitHub Actions for regular releases."
else
  export NODE_AUTH_TOKEN="${NODE_AUTH_TOKEN:-$NPM_TOKEN}"
fi

cd "$ROOT"

echo "==> Build"
pnpm build

echo "==> Typecheck"
pnpm typecheck

echo "==> Unit tests"
pnpm test:unit

if grep -r '"workspace:\*"' packages/*/package.json >/dev/null 2>&1; then
  echo "ERROR: workspace:* found — use workspace:^ instead" >&2
  exit 1
fi

PUBLISH_FLAGS=(--access public --no-git-checks)
if [ "$DRY_RUN" = true ]; then
  PUBLISH_FLAGS+=(--dry-run)
  echo "==> Dry-run publish (no upload)"
else
  echo "==> Publish @guidekit/* packages"
fi

pnpm -r --filter './packages/*' publish "${PUBLISH_FLAGS[@]}"

if [ "$DRY_RUN" = false ]; then
  echo ""
  echo "Published versions:"
  for pkg in core react server cli vanilla vad intelligence knowledge plugins; do
    version="$(node -p "require('./packages/$pkg/package.json').version")"
    echo "  @guidekit/$pkg@$version  https://www.npmjs.com/package/@guidekit/$pkg"
  done
fi
