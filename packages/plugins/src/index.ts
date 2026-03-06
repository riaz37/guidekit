export const PLUGINS_VERSION = '0.1.0';
export { MiddlewarePipeline } from './middleware.js';
export { definePlugin } from './define-plugin.js';
export { PluginRegistry } from './plugin-registry.js';
export {
  createPluginTestHarness, mockPluginContext, assertPluginInstalls,
  type PluginTestHarness,
} from './testing.js';
export type {
  PluginDefinition,
  PluginContext,
  PluginHooks,
  PluginMetadata,
  MiddlewareFunction,
} from '@guidekit/core';
