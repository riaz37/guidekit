# @guidekit/plugins

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

[![npm version](https://img.shields.io/npm/v/@guidekit/plugins?style=flat-square)](https://www.npmjs.com/package/@guidekit/plugins)

Plugin registry and lifecycle hooks for GuideKit Platform Mode.

- `definePlugin()` — typed plugin authoring
- Hooks: `beforeLLMCall`, `afterLLMCall`, `beforeToolExecution`, `afterToolExecution`, `onError`
- Context providers and custom tools via plugin `setup()`

Requires `@guidekit/core@^1.0.0`. Enable with `plugins={[myPlugin]}` on `GuideKitProvider`.
