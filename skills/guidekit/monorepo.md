# GuideKit Monorepo Rules

## Workspace

- **Package manager**: pnpm 10.25+
- **Task runner**: Turborepo (`turbo.json`)
- **Workspace globs**: `packages/*`, `apps/*` (`pnpm-workspace.yaml`)
- **Internal deps**: `workspace:^` (never `workspace:*`)

## Package tiers

### Tier A — Core integration path

| Package | Publish name | Notes |
|---------|--------------|-------|
| `packages/core` | `@guidekit/core` | Facade + pipeline; keep `core.ts` ~400 LOC |
| `packages/react` | `@guidekit/react` | Subpath `@guidekit/react/widget` for widget bundle |
| `packages/server` | `@guidekit/server` | Subpath `@guidekit/server/next` for App Router |

### Tier B — Optional extensions

Loaded via dynamic import from `createPlatformExtensions()`:

- `@guidekit/intelligence` — semantic page model
- `@guidekit/knowledge` — BM25/TF-IDF context
- `@guidekit/plugins` — plugin registry

Do **not** import Tier B packages statically from Tier A code paths that ship to all users.

### Tier C — DX / embed alternatives

- `@guidekit/cli` — scaffolding and doctor
- `@guidekit/vanilla` — script-tag bundle
- `@guidekit/vad` — voice activity detection

## Build conventions

- **Bundler**: tsup per package
- **Output**: dual ESM/CJS + `.d.ts`
- **`sideEffects: false`** on all packages
- Root `vitest.config.ts` with aliases for optional packages in tests

## Apps

### `apps/docs`

- Nextra MDX docs
- Update when public API or integration steps change

### `apps/example-nextjs`

- Reference integration: proxy mode, platform extensions
- API routes under `app/api/guidekit/`
- Platform wiring in `lib/guidekit-platform.ts`

## Where to put new code

| Concern | Location |
|---------|----------|
| New pipeline stage | `packages/core/src/pipeline/` |
| Core subsystem extraction | `packages/core/src/core/<name>.ts` |
| React hook | `packages/react/src/hooks/` |
| Server middleware | `packages/server/src/middleware/` |
| LLM/voice proxy | `packages/server/src/proxy/` |
| E2E scenario | `e2e/` |

## Changesets

User-facing package changes require a changeset:

```bash
pnpm changeset
```

Select affected `@guidekit/*` packages and describe the change.

## Agent discovery

```bash
pnpm skills:sync      # Link skills/guidekit -> .agents/skills/guidekit
pnpm llms:generate    # Refresh root llms.txt
```
