# GuideKit Agent Guide

## Repository Purpose

- GuideKit is a **multi-package AI guidance SDK** for web apps — DOM intelligence, LLM orchestration, voice, and visual guidance.
- **Published npm packages** live under `packages/` (`@guidekit/core`, `@guidekit/react`, `@guidekit/server`, and optional extensions).
- Treat **docs**, **example app**, **CLI**, and **server proxy routes** as one product surface — changes in one often require updates in others.

## Required Context Before Code Changes

Before adding or changing SDK behavior, read these in order:

1. `skills/guidekit/SKILL.md`
2. `skills/guidekit/monorepo.md`
3. `apps/docs/app/docs/architecture/page.mdx` (public architecture docs)
4. `CONTRIBUTING.md` (build, test, changeset workflow)

For package-specific work, also read the package README under `packages/<name>/`.

## Monorepo Layout

```
guidekit/
├── apps/
│   ├── docs/              # Nextra docs site (MDX)
│   └── example-nextjs/    # Reference Next.js integration (proxy mode)
├── packages/
│   ├── core/              # Engine facade + pipeline + cognitive layer
│   ├── react/             # Provider, hooks/, widget/
│   ├── server/            # Token auth, LLM/voice proxy, Next adapter
│   ├── cli/               # init, doctor, generate-secret
│   ├── vanilla/, vad/     # Optional browser bundles
│   └── intelligence/, knowledge/, plugins/  # Tier B extensions (dynamic import)
├── e2e/                   # Playwright agent flows
├── scripts/               # Repo maintenance (check, stats, llms.txt)
└── skills/guidekit/       # Agent skill for this monorepo
```

## Architecture Rules

### Core facade stays thin

- `packages/core/src/core.ts` is a **facade** (~400 LOC target). Extract new subsystems into `packages/core/src/core/`.
- Pipeline orchestration lives in `packages/core/src/pipeline/`.
- Optional packages (`intelligence`, `knowledge`, `plugins`) are loaded via **dynamic import** in `pipeline/extensions.ts` — never add hard dependencies from core to Tier B packages.

### Security boundary

- **Never expose LLM API keys in the browser.** Use `@guidekit/server` proxy routes (`/api/guidekit/token`, `/api/guidekit/llm`).
- `llm.apiKey` on the client is **deprecated**; prefer proxy mode in examples and docs.

### Package boundaries

| Package | Owns |
|---------|------|
| `core` | DOM scan, context, LLM loop, tools, voice/visual primitives, pipeline |
| `react` | Provider, hooks, Shadow DOM widget — no business logic duplication |
| `server` | Session store, auth, rate limit, Next.js adapter |
| `intelligence` | Semantic page analysis |
| `knowledge` | BM25/TF-IDF retrieval |
| `plugins` | Plugin registry and hooks |

### Testing expectations

- Unit tests: Vitest (`pnpm test:unit`)
- E2E: Playwright (`pnpm test:e2e`) — agent flows in `e2e/`
- New pipeline or cognitive behavior needs unit coverage; integration changes should touch example app or E2E when user-facing

## Commands

```bash
pnpm install
pnpm skills:sync          # Link skills/guidekit for Codex/Cursor discovery
pnpm dev                  # Start docs + example apps
pnpm build                # Build all packages
pnpm check                # Full CI parity (build, typecheck, lint, test)
pnpm publish:packages:dry-run  # Dry-run npm publish locally
pnpm stats                # Package LOC + core facade size
pnpm llms:generate        # Regenerate llms.txt agent index
pnpm changeset            # Version bump for published packages
```

## Validation Checklist

Before opening a PR:

1. `pnpm check` passes
2. Changeset added if any `@guidekit/*` public API or behavior changed
3. Docs updated in `apps/docs/` when integration steps change
4. `apps/example-nextjs/` updated when proxy or provider API changes
5. Core facade not bloated — run `pnpm stats` if touching `core.ts`

## Philosophy

- **SDK-first**: Multiple published packages, not a copy-paste registry.
- **Extend, don't fork**: Tier B packages plug in via dynamic imports and pipeline hooks.
- **Proxy by default**: Server holds secrets; client holds session tokens only.
- **Measure**: Telemetry spans and token budgets are first-class — preserve observability when refactoring.
