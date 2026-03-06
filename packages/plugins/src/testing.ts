import type {
  PluginDefinition, PluginContext, PluginHooks,
  AgentState, ToolDefinition,
} from '@guidekit/core';
import { PluginRegistry } from './plugin-registry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PluginTestHarness {
  /** Install a plugin into the test harness. */
  install(plugin: PluginDefinition): Promise<void>;
  /** Uninstall a plugin by name. */
  uninstall(pluginName: string): Promise<void>;
  /** Execute a middleware hook with test context. */
  executeHook<T>(hook: keyof PluginHooks, ctx: T): Promise<T>;
  /** Get tools registered by plugins. */
  getRegisteredTools(): ToolDefinition[];
  /** Get context provider IDs registered by plugins. */
  getContextProviders(): string[];
  /** Access emitted events for assertions. */
  getEmittedEvents(): Array<{ event: string; data: unknown }>;
  /** Tear down all plugins. */
  destroy(): Promise<void>;
}

// ---------------------------------------------------------------------------
// createPluginTestHarness
// ---------------------------------------------------------------------------

/** Create an isolated test harness with a real PluginRegistry backed by mocks. */
export function createPluginTestHarness(options?: {
  agentState?: AgentState;
  debug?: boolean;
}): PluginTestHarness {
  const emittedEvents: Array<{ event: string; data: unknown }> = [];

  const bus = {
    on: (_event: string, _handler: (...args: unknown[]) => void): (() => void) => () => {},
    emit: (event: string, data: unknown): void => { emittedEvents.push({ event, data }); },
  };

  const registry = new PluginRegistry({
    bus,
    getAgentState: () => options?.agentState ?? { status: 'idle' as const },
    debug: options?.debug ?? false,
  });

  return {
    install: (plugin) => registry.install(plugin),
    uninstall: (name) => registry.uninstall(name),
    executeHook: <T>(hook: keyof PluginHooks, ctx: T) =>
      registry.getPipeline<T>(hook).execute(ctx),
    getRegisteredTools: () => registry.getRegisteredTools().map((t) => t.definition),
    getContextProviders: () => registry.getContextProviders().map((c) => c.id),
    getEmittedEvents: () => emittedEvents,
    destroy: () => registry.destroy(),
  };
}

// ---------------------------------------------------------------------------
// mockPluginContext
// ---------------------------------------------------------------------------

/** Create a mock PluginContext for unit testing a plugin's setup() in isolation. */
export function mockPluginContext(overrides?: Partial<PluginContext>): PluginContext {
  return {
    bus: { on: () => () => {} },
    registerTool: () => {},
    addContextProvider: () => {},
    getAgentState: () => ({ status: 'idle' as const }),
    log: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// assertPluginInstalls
// ---------------------------------------------------------------------------

/** Assert a plugin installs without errors. Convenience wrapper. */
export async function assertPluginInstalls(plugin: PluginDefinition): Promise<void> {
  const harness = createPluginTestHarness();
  try {
    await harness.install(plugin);
  } catch (err) {
    const name = plugin?.metadata?.name ?? 'unknown';
    throw new Error(
      `Plugin "${name}" failed to install: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  } finally {
    await harness.destroy();
  }
}
