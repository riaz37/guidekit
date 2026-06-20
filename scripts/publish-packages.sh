#!/usr/bin/env bash
# Publish all @guidekit/* packages to npm in dependency order.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help)
      echo "Usage: bash scripts/publish-packages.sh [--dry-run]"
      exit 0
      ;;
    *)
      echo "Error: unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT/.env"
  set +a
fi

if [ -n "${NPM_TOKEN:-}" ]; then
  export NODE_AUTH_TOKEN="${NODE_AUTH_TOKEN:-$NPM_TOKEN}"
fi

if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
  echo "Error: NODE_AUTH_TOKEN or NPM_TOKEN is required." >&2
  echo "Create an npm Automation token with Read and Write access to @guidekit." >&2
  exit 1
fi

cd "$ROOT"

echo "==> Verify npm publish access"
if ! (cd "$ROOT/packages/core" && pnpm publish --dry-run --access public --no-git-checks >/dev/null 2>&1); then
  echo "Error: NPM token cannot publish to @guidekit." >&2
  echo "Create an Automation token with Read and Write permissions for @guidekit:" >&2
  echo "  https://www.npmjs.com/settings/~tokens" >&2
  exit 1
fi

echo "==> Build"
pnpm build

echo "==> Typecheck"
pnpm typecheck

echo "==> Unit tests"
pnpm test:unit

if grep -r '"workspace:\*"' packages/*/package.json >/dev/null 2>&1; then
  echo "Error: workspace:* found — use workspace:^ instead" >&2
  exit 1
fi

# Dependency-friendly publish order (RemotionUI-style: one package at a time)
PACKAGES=(core server react cli vanilla vad intelligence knowledge plugins)

PUBLISH_FLAGS=(--access public --no-git-checks)
if [ "$DRY_RUN" = true ]; then
  PUBLISH_FLAGS+=(--dry-run)
  echo "==> Dry-run publish"
else
  echo "==> Publish @guidekit/* packages"
fi

for pkg in "${PACKAGES[@]}"; do
  pkg_dir="$ROOT/packages/$pkg"
  if [ ! -f "$pkg_dir/package.json" ]; then
    continue
  fi
  name="$(node -p "require('$pkg_dir/package.json').name")"
  version="$(node -p "require('$pkg_dir/package.json').version")"
  echo ""
  echo "-> $name@$version"

  if [ "$DRY_RUN" = false ]; then
    published="$(npm view "${name}@${version}" version 2>/dev/null || true)"
    if [ "$published" = "$version" ]; then
      echo "   skip (already published)"
      continue
    fi
  fi

  # pnpm publish rewrites workspace:^ to semver ranges in the tarball.
  # npm publish does not — it ships literal "workspace:^" and breaks consumers.
  (cd "$pkg_dir" && pnpm publish "${PUBLISH_FLAGS[@]}")
done

if [ "$DRY_RUN" = false ]; then
  echo ""
  echo "Published:"
  for pkg in "${PACKAGES[@]}"; do
    version="$(node -p "require('./packages/$pkg/package.json').version" 2>/dev/null || echo '?')"
    echo "  @guidekit/$pkg@$version"
  done
fi
