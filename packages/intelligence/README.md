# @guidekit/intelligence

<p align="center">
  <a href="https://guidekit-docs.vercel.app">
    <img src="../../assets/brand/wordmark.svg" alt="GuideKit" width="200" />
  </a>
</p>

<p align="center">
  <a href="https://guidekit-docs.vercel.app/docs/platform-mode">Documentation</a>
  ·
  <a href="https://github.com/riaz37/guidekit">GitHub</a>
</p>

[![npm version](https://img.shields.io/npm/v/@guidekit/intelligence?style=flat-square)](https://www.npmjs.com/package/@guidekit/intelligence)

Semantic page intelligence for GuideKit Platform Mode.

- `SemanticScanner` — enriches DOM `PageModel` into `SemanticPageModel`
- `HallucinationGuard` — advisory post-response validation (heuristic)

Requires `@guidekit/core@^1.0.0`. Enable with `intelligence={true}` on `GuideKitProvider`.
