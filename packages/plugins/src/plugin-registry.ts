import type {
  PluginDefinition, PluginContext, PluginHooks, PluginMetadata,
  ToolDefinition, AgentState, MiddlewareFunction,
} from '@guidekit/core';
import { PluginError, ErrorCodes } from '@guidekit/core';
import { MiddlewarePipeline } from './middleware.js';

// ---------------------------------------------------------------------------
// Internal state per plugin
// ---------------------------------------------------------------------------

interface PluginEntry {
  definition: PluginDefinition;
  state: 'active' | 'inactive';
  cleanup: (() => void) | null;
  registeredTools: string[];
  contextProviders: string[];
  eventUnsubs: Array<() => void>;
}

// ---------------------------------------------------------------------------
// Registered tool / context provider records
// ---------------------------------------------------------------------------

interface RegisteredTool {
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
  pluginName: string;
}

interface RegisteredContextProvider {
  id: string;
  provider: () => string | Promise<string>;
  pluginName: string;
}

// ---------------------------------------------------------------------------
// Hook names (used for iterating pipelines)
// ---------------------------------------------------------------------------

const HOOK_NAMES: ReadonlyArray<keyof PluginHooks> = [
  'beforeLLMCall', 'afterLLMCall', 'beforeToolExecution', 'afterToolExecution', 'onError',
] as const;

const MAX_DEPENDENCIES = 10;

// ---------------------------------------------------------------------------
// PluginRegistry
// ---------------------------------------------------------------------------

export class PluginRegistry {
  private entries = new Map<string, PluginEntry>();
  private tools = new Map<string, RegisteredTool>();
  private contexts = new Map<string, RegisteredContextProvider>();
  private pipelines = new Map<string, MiddlewarePipeline<unknown>>();
  private hookRefs = new Map<string, Map<keyof PluginHooks, MiddlewareFunction<unknown>>>();

  private bus?: {
    on: (event: string, handler: (...args: unknown[]) => void) => () => void;
    emit: (event: string, data: unknown) => void;
  };
  private getAgentState: () => AgentState;
  private debug: boolean;

  constructor(options?: {
    bus?: { on: (event: string, handler: (...args: unknown[]) => void) => () => void; emit: (event: string, data: unknown) => void };
    getAgentState?: () => AgentState;
    debug?: boolean;
  }) {
    this.bus = options?.bus;
    this.getAgentState = options?.getAgentState ?? (() => ({ status: 'idle' as const }));
    this.debug = options?.debug ?? false;

    for (const name of HOOK_NAMES) {
      this.pipelines.set(name, new MiddlewarePipeline<unknown>());
    }
  }

  // -----------------------------------------------------------------------
  // install
  // -----------------------------------------------------------------------

  async install(plugin: PluginDefinition): Promise<void> {
    // Brand check
    if (plugin?.__brand !== 'GuideKitPlugin') {
      throw new PluginError({
        code: ErrorCodes.PLUGIN_INSTALL_FAILED,
        message: 'Invalid plugin: missing __brand === "GuideKitPlugin".',
        suggestion: 'Use definePlugin() to create valid plugins.',
      });
    }

    const name = plugin.metadata.name;

    // Duplicate check
    if (this.entries.has(name)) {
      throw new PluginError({
        code: ErrorCodes.PLUGIN_INSTALL_FAILED,
        message: `Plugin "${name}" is already installed.`,
        suggestion: 'Uninstall the existing plugin first or use a different name.',
      });
    }

    // Dependency resolution
    const deps = plugin.metadata.dependencies ?? [];
    if (deps.length > MAX_DEPENDENCIES) {
      throw new PluginError({
        code: ErrorCodes.PLUGIN_DEPENDENCY_MISSING,
        message: `Plugin "${name}" declares ${deps.length} dependencies (max ${MAX_DEPENDENCIES}).`,
        suggestion: 'Reduce the number of plugin dependencies.',
      });
    }
    for (const dep of deps) {
      if (!this.entries.has(dep)) {
        throw new PluginError({
          code: ErrorCodes.PLUGIN_DEPENDENCY_MISSING,
          message: `Plugin "${name}" requires "${dep}" which is not installed.`,
          suggestion: `Install "${dep}" before "${name}".`,
        });
      }
    }

    // Build scoped context
    const entry: PluginEntry = {
      definition: plugin,
      state: 'active',
      cleanup: null,
      registeredTools: [],
      contextProviders: [],
      eventUnsubs: [],
    };

    const ctx = this.buildContext(name, entry);

    // Call setup
    let cleanup: (() => void) | void;
    try {
      cleanup = await plugin.setup(ctx);
    } catch (err) {
      throw new PluginError({
        code: ErrorCodes.PLUGIN_INSTALL_FAILED,
        message: `Plugin "${name}" setup failed: ${err instanceof Error ? err.message : String(err)}`,
        suggestion: 'Check the plugin setup function for errors.',
        cause: err instanceof Error ? err : undefined,
      });
    }
    entry.cleanup = typeof cleanup === 'function' ? cleanup : null;

    // Insert hooks into pipelines
    this.insertHooks(name, plugin.hooks);

    // Store entry
    this.entries.set(name, entry);

    this.bus?.emit('plugin:installed', { name });
    this.log(`Plugin "${name}" installed.`);
  }

  // -----------------------------------------------------------------------
  // uninstall
  // -----------------------------------------------------------------------

  async uninstall(pluginName: string): Promise<void> {
    const entry = this.entries.get(pluginName);
    if (!entry) return;

    // Check dependents
    for (const [otherName, otherEntry] of this.entries) {
      if (otherName === pluginName) continue;
      if (otherEntry.definition.metadata.dependencies?.includes(pluginName)) {
        throw new PluginError({
          code: ErrorCodes.PLUGIN_DEPENDENCY_MISSING,
          message: `Cannot uninstall "${pluginName}": "${otherName}" depends on it.`,
          suggestion: `Uninstall "${otherName}" first.`,
        });
      }
    }

    // Cleanup
    try { entry.cleanup?.(); } catch { /* best effort */ }

    // Remove hooks
    this.removeHooks(pluginName);

    // Remove tools
    for (const toolName of entry.registeredTools) {
      this.tools.delete(toolName);
    }

    // Remove context providers
    for (const id of entry.contextProviders) {
      this.contexts.delete(id);
    }

    // Unsub events
    for (const unsub of entry.eventUnsubs) {
      try { unsub(); } catch { /* best effort */ }
    }

    this.entries.delete(pluginName);
    this.bus?.emit('plugin:uninstalled', { name: pluginName });
    this.log(`Plugin "${pluginName}" uninstalled.`);
  }

  // -----------------------------------------------------------------------
  // deactivate / activate
  // -----------------------------------------------------------------------

  deactivate(pluginName: string): void {
    const entry = this.entries.get(pluginName);
    if (!entry || entry.state === 'inactive') return;

    this.removeHooks(pluginName);
    entry.state = 'inactive';
    this.bus?.emit('plugin:deactivated', { name: pluginName });
    this.log(`Plugin "${pluginName}" deactivated.`);
  }

  activate(pluginName: string): void {
    const entry = this.entries.get(pluginName);
    if (!entry || entry.state === 'active') return;

    this.insertHooks(pluginName, entry.definition.hooks);
    entry.state = 'active';
    this.bus?.emit('plugin:activated', { name: pluginName });
    this.log(`Plugin "${pluginName}" activated.`);
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  getInstalledPlugins(): PluginMetadata[] {
    return [...this.entries.values()].map((e) => ({ ...e.definition.metadata }));
  }

  getPluginState(name: string): 'active' | 'inactive' | 'not-found' {
    const entry = this.entries.get(name);
    return entry ? entry.state : 'not-found';
  }

  getPipeline<T>(hook: keyof PluginHooks): MiddlewarePipeline<T> {
    return this.pipelines.get(hook) as MiddlewarePipeline<T>;
  }

  getRegisteredTools(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  getContextProviders(): RegisteredContextProvider[] {
    return [...this.contexts.values()];
  }

  // -----------------------------------------------------------------------
  // destroy
  // -----------------------------------------------------------------------

  async destroy(): Promise<void> {
    // Uninstall in reverse order to respect dependencies
    const names = [...this.entries.keys()].reverse();
    for (const name of names) {
      await this.uninstall(name);
    }
    for (const p of this.pipelines.values()) p.clear();
    this.tools.clear();
    this.contexts.clear();
    this.hookRefs.clear();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildContext(pluginName: string, entry: PluginEntry): PluginContext {
    return {
      bus: {
        on: (event: string, handler: (...args: unknown[]) => void): () => void => {
          if (!this.bus) {
            // no-op unsub if no bus provided
            return () => {};
          }
          const unsub = this.bus.on(event, handler);
          entry.eventUnsubs.push(unsub);
          return unsub;
        },
      },

      registerTool: (definition: ToolDefinition, handler: (args: Record<string, unknown>) => Promise<unknown>): void => {
        if (this.tools.has(definition.name)) {
          throw new PluginError({
            code: ErrorCodes.PLUGIN_TOOL_CONFLICT,
            message: `Tool "${definition.name}" is already registered by another plugin.`,
            suggestion: 'Use a unique tool name or uninstall the conflicting plugin.',
          });
        }
        this.tools.set(definition.name, { definition, handler, pluginName });
        entry.registeredTools.push(definition.name);
      },

      addContextProvider: (id: string, provider: () => string | Promise<string>): void => {
        this.contexts.set(id, { id, provider, pluginName });
        entry.contextProviders.push(id);
      },

      getAgentState: () => this.getAgentState(),

      log: (...args: unknown[]) => {
        if (this.debug) {
          // eslint-disable-next-line no-console
          console.log(`[guidekit:plugin:${pluginName}]`, ...args);
        }
      },
    };
  }

  private insertHooks(pluginName: string, hooks: Readonly<PluginHooks>): void {
    const refs = new Map<keyof PluginHooks, MiddlewareFunction<unknown>>();
    for (const hookName of HOOK_NAMES) {
      const fn = hooks[hookName] as MiddlewareFunction<unknown> | undefined;
      if (fn) {
        this.pipelines.get(hookName)!.use(fn);
        refs.set(hookName, fn);
      }
    }
    this.hookRefs.set(pluginName, refs);
  }

  private removeHooks(pluginName: string): void {
    const refs = this.hookRefs.get(pluginName);
    if (!refs) return;
    for (const [hookName, fn] of refs) {
      this.pipelines.get(hookName)!.remove(fn);
    }
    this.hookRefs.delete(pluginName);
  }

  private log(msg: string): void {
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.log(`[guidekit:plugin-registry] ${msg}`);
    }
  }
}
