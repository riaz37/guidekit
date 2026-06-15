# Contributing to GuideKit

Thank you for your interest in contributing to GuideKit! This document provides guidelines and instructions for contributing.

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 10.25+

### Setup

```bash
git clone https://github.com/riaz37/guidekit.git
cd guidekit
pnpm install
pnpm build
```

### Verify Your Setup

```bash
pnpm typecheck    # TypeScript strict mode
pnpm lint         # ESLint
pnpm test         # Unit tests (Vitest)
```

### Production readiness gate (before publishing)

Use the full release gate locally (it runs the live E2E suite twice):

```bash
pnpm check:release
```

This requires a real `LLM_API_KEY` (or `apps/example-nextjs/.env.local`) and will skip npm publish dry-run unless `NODE_AUTH_TOKEN`/`NPM_TOKEN` is present.

## Development Workflow

1. **Fork** the repository and create a feature branch from `main`.
2. **Make changes** in the relevant package(s) under `packages/`.
3. **Add tests** for any new functionality.
4. **Run the full check suite** before submitting:

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

5. **Create a changeset** describing your change:

```bash
pnpm changeset
```

6. **Submit a pull request** against the `main` branch.

## Project Structure

```
packages/
  core/         - Core engine (DOM intelligence, LLM orchestration)
  react/        - React bindings (Provider, hooks, widget)
  server/       - Server utilities (token generation)
  vanilla/      - Vanilla JS IIFE bundle
  vad/          - Voice Activity Detection (Silero ONNX)
  cli/          - CLI tools (init, doctor, generate-secret)
  intelligence/ - Semantic page analysis
  knowledge/    - BM25/TF-IDF search
  plugins/      - Plugin system
apps/
  docs/         - Documentation site (Nextra)
  example-nextjs/ - Reference Next.js app
e2e/            - Playwright E2E tests
scripts/        - Repo maintenance (check, stats, llms.txt)
skills/         - Agent skills (see AGENTS.md)
```

## AI / Agent Contributors

If you are an AI agent or using Codex/Cursor agent mode, start with [AGENTS.md](./AGENTS.md).

```bash
pnpm skills:sync    # Link skills/guidekit for agent discovery
pnpm check          # Full validation suite
pnpm stats          # Package LOC + core facade size
```

## Code Style

- TypeScript strict mode (ES2022 target)
- ESLint for linting
- Dual ESM/CJS output via tsup
- `sideEffects: false` in all packages
- Use `workspace:^` for internal dependencies (never `workspace:*`)

## Testing

- **Unit tests**: `pnpm test` (Vitest with jsdom)
- **E2E tests**: `pnpm test:e2e` (Playwright)
- **Coverage**: `pnpm test:coverage` (80% statement / 70% branch target)
- **Bundle size**: `pnpm size:check` (enforced limits per package)

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat(core): add new DOM scanning strategy`
- `fix(react): prevent hook re-render on status change`
- `docs: update getting started guide`
- `test(vad): add processFrame edge cases`

## Changesets

We use [Changesets](https://github.com/changesets/changesets) for versioning. When your PR includes user-facing changes, create a changeset:

```bash
pnpm changeset
```

Select the affected packages and describe the change. The changeset file will be committed with your PR.

## Publishing

Version bumps use Changesets. Publishing follows the RemotionUI pattern: **GitHub Actions for real releases**, local script for dry-runs.

### Release workflow

1. Create a changeset and merge to `main`:

```bash
pnpm changeset
pnpm changeset version   # bumps package.json + CHANGELOGs
git add -A && git commit -m "chore: version packages"
git push origin main
```

2. **Publish to npm** via GitHub Actions:

   - Go to **Actions → Publish Packages → Run workflow**
   - Run with `dry_run: true` first to verify tarballs
   - Run again with `dry_run: false` to publish
   - Requires `NPM_TOKEN` in the `npm-publish` environment secret

3. **Create a GitHub Release** (optional, tag only):

```bash
git tag v0.3.0
git push origin v0.3.0
```

Tag push triggers `.github/workflows/release.yml` (GitHub Release notes only — no npm upload).

### Local publish (fallback)

```bash
pnpm publish:packages:dry-run   # verify without upload
pnpm publish:packages           # requires NPM_TOKEN in .env or ~/.npmrc
```

Do not use `--provenance` locally; CI handles provenance via OIDC.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
