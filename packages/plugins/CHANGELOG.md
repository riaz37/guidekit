# @guidekit/plugins

## 1.0.0

### Minor Changes

- feat(plugins): add @guidekit/plugins package with plugin system

  - definePlugin() API for creating type-safe plugin definitions
  - PluginRegistry with install/uninstall/activate/deactivate lifecycle
  - MiddlewarePipeline for intercepting LLM calls, tool execution, and errors
  - Plugin types added to @guidekit/core: PluginDefinition, PluginContext, PluginHooks, PluginMetadata

### Patch Changes

- Updated dependencies
  - @guidekit/core@0.1.0
