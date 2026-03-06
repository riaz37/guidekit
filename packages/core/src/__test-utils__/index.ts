/**
 * Single import point for GuideKit core test utilities.
 *
 * @module @guidekit/core/__test-utils__
 *
 * @example
 * ```ts
 * import { createCoreMocks, textResponse, ScriptedLLMAdapter } from '../__test-utils__/index.js';
 * ```
 */
export {
  // Aggregate factory
  createCoreMocks,
  // Individual mock factories
  createMockEventBus,
  createMockResourceManager,
  createMockDOMScanner,
  createMockContextManager,
  createMockLLMOrchestrator,
  createMockToolExecutor,
  createMockConnectionManager,
  createMockNavigationController,
  createMockVisualGuidance,
  createMockAwarenessSystem,
  createMockProactiveEngine,
  createMockRateLimiter,
  createMockI18n,
  createMockTokenManager,
  // Data factories
  createMockPageModel,
  createMockStore,
  // Response helpers
  textResponse,
  toolCallResponse,
  // Scripted adapter
  ScriptedLLMAdapter,
} from './core-mocks.js';

export type { ScriptedResponse } from './core-mocks.js';
