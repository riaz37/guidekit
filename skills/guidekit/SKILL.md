---
name: guidekit
description: >-
  Work with the GuideKit monorepo — multi-package AI guidance SDK, pipeline
  orchestration, server proxy mode, React provider, and optional platform
  extensions. Use when changing @guidekit/* packages, docs, or example app.
metadata:
  tags: guidekit, sdk, monorepo, ai, react, llm
---

# GuideKit

Use this skill when working in the GuideKit monorepo or helping users integrate the SDK.

## When to use

- Changing `@guidekit/core`, `@guidekit/react`, or `@guidekit/server`
- Adding pipeline stages, cognitive behavior, or platform extensions
- Updating proxy routes, token auth, or example Next.js app
- Writing docs or E2E tests for guidance flows

## Key paths

- Core facade: `packages/core/src/core.ts`
- Core subsystems: `packages/core/src/core/`
- Pipeline: `packages/core/src/pipeline/`
- Platform extensions: `packages/core/src/pipeline/extensions.ts`
- React provider: `packages/react/src/provider.tsx`
- Widget: `packages/react/src/widget/`
- Server proxy: `packages/server/src/proxy/`, `packages/server/src/adapters/next.ts`
- Example app: `apps/example-nextjs/`
- Docs: `apps/docs/app/docs/`

## Commands

```bash
pnpm changeset
pnpm changeset version
pnpm publish:packages:dry-run
pnpm publish:packages   # local fallback; prefer GitHub Actions
```

## Reference docs

- [Monorepo rules](monorepo.md)
- [AGENTS.md](../../AGENTS.md)
- [Architecture docs](../../apps/docs/app/docs/architecture/page.mdx)

## Philosophy

Multiple npm packages compose the SDK. Core stays thin; extensions load dynamically. API keys stay on the server.
