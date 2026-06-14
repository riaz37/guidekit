# @guidekit/plugins

Plugin registry and lifecycle hooks for GuideKit Platform Mode.

- `definePlugin()` — typed plugin authoring
- Hooks: `beforeLLMCall`, `afterLLMCall`, `beforeToolExecution`, `afterToolExecution`, `onError`
- Context providers and custom tools via plugin `setup()`

Requires `@guidekit/core@^1.0.0`. Enable with `plugins={[myPlugin]}` on `GuideKitProvider`.
