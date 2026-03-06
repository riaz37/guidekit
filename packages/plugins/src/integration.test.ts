import { describe, it, expect, afterEach } from 'vitest';
import { PluginRegistry } from './plugin-registry.js';
import { definePlugin } from './define-plugin.js';
import { PluginError } from '@guidekit/core';
import type { PluginDefinition } from '@guidekit/core';

function createTestPlugin(overrides: Partial<Parameters<typeof definePlugin>[0]> = {}): PluginDefinition {
  return definePlugin({
    name: 'test-plugin',
    version: '1.0.0',
    setup: () => {},
    ...overrides,
  });
}

function createRegistryWithBus() {
  const events: Array<{ event: string; data: unknown }> = [];
  const bus = {
    on: (_event: string, _handler: (...args: unknown[]) => void): (() => void) => () => {},
    emit: (event: string, data: unknown): void => { events.push({ event, data }); },
  };
  const registry = new PluginRegistry({ bus });
  return { registry, events };
}

describe('Plugin Integration', () => {
  let registry: PluginRegistry;

  afterEach(async () => {
    if (registry) await registry.destroy();
  });

  it('plugin registers a tool via setup(), tool appears in getRegisteredTools()', async () => {
    ({ registry } = createRegistryWithBus());

    const toolDef = {
      name: 'my-tool',
      description: 'A custom tool',
      parameters: { input: { type: 'string' as const, description: 'input value' } },
      schemaVersion: 1,
    };

    const plugin = createTestPlugin({
      setup: (ctx) => {
        ctx.registerTool(toolDef, async (args) => `result: ${args.input}`);
      },
    });

    await registry.install(plugin);

    const tools = registry.getRegisteredTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.definition.name).toBe('my-tool');

    // Verify the handler works
    const result = await tools[0]!.handler({ input: 'hello' });
    expect(result).toBe('result: hello');
  });

  it('plugin adds context provider, provider appears in getContextProviders()', async () => {
    ({ registry } = createRegistryWithBus());

    const plugin = createTestPlugin({
      setup: (ctx) => {
        ctx.addContextProvider('page-info', () => 'current page: /home');
      },
    });

    await registry.install(plugin);

    const providers = registry.getContextProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]!.id).toBe('page-info');
    expect(await providers[0]!.provider()).toBe('current page: /home');
  });

  it('plugin hooks modify LLM call context through middleware pipeline', async () => {
    ({ registry } = createRegistryWithBus());

    const plugin = createTestPlugin({
      hooks: {
        beforeLLMCall: async (ctx, next) => {
          ctx.systemPrompt += ' [injected by plugin]';
          return next();
        },
      },
    });

    await registry.install(plugin);

    const pipeline = registry.getPipeline<{
      systemPrompt: string;
      userMessage: string;
      conversationHistory: Array<{ role: string; content: string }>;
      metadata: Record<string, unknown>;
    }>('beforeLLMCall');

    const result = await pipeline.execute({
      systemPrompt: 'You are helpful.',
      userMessage: 'Hi',
      conversationHistory: [],
      metadata: {},
    });

    expect(result.systemPrompt).toBe('You are helpful. [injected by plugin]');
  });

  it('two plugins with dependency: install order matters', async () => {
    ({ registry } = createRegistryWithBus());

    const base = createTestPlugin({ name: 'base-plugin' });
    const dependent = createTestPlugin({
      name: 'dependent-plugin',
      dependencies: ['base-plugin'],
    });

    // Wrong order fails
    await expect(registry.install(dependent)).rejects.toThrow(PluginError);

    // Correct order succeeds
    await registry.install(base);
    await registry.install(dependent);

    expect(registry.getInstalledPlugins()).toHaveLength(2);
  });

  it('plugin uninstall removes its tools and hooks', async () => {
    ({ registry } = createRegistryWithBus());

    const toolDef = {
      name: 'ephemeral-tool',
      description: 'Temporary',
      parameters: {},
      schemaVersion: 1,
    };

    const plugin = createTestPlugin({
      hooks: {
        beforeLLMCall: async (ctx, next) => {
          ctx.metadata.tagged = true;
          return next();
        },
      },
      setup: (ctx) => {
        ctx.registerTool(toolDef, async () => 'tmp');
      },
    });

    await registry.install(plugin);
    expect(registry.getRegisteredTools()).toHaveLength(1);

    await registry.uninstall('test-plugin');
    expect(registry.getRegisteredTools()).toHaveLength(0);

    // Hook should no longer modify context
    const pipeline = registry.getPipeline<{
      systemPrompt: string;
      userMessage: string;
      conversationHistory: Array<{ role: string; content: string }>;
      metadata: Record<string, unknown>;
    }>('beforeLLMCall');
    const result = await pipeline.execute({
      systemPrompt: '',
      userMessage: '',
      conversationHistory: [],
      metadata: {},
    });
    expect(result.metadata.tagged).toBeUndefined();
  });

  it('full lifecycle: install -> deactivate -> activate -> uninstall', async () => {
    const { registry: reg, events } = createRegistryWithBus();
    registry = reg;

    const plugin = createTestPlugin({
      hooks: {
        beforeLLMCall: async (ctx, next) => {
          ctx.metadata.active = true;
          return next();
        },
      },
      setup: () => {
        return () => { /* cleanup */ };
      },
    });

    // Install
    await registry.install(plugin);
    expect(registry.getPluginState('test-plugin')).toBe('active');

    // Verify hook is active
    const pipeline = registry.getPipeline<{
      systemPrompt: string;
      userMessage: string;
      conversationHistory: Array<{ role: string; content: string }>;
      metadata: Record<string, unknown>;
    }>('beforeLLMCall');

    let result = await pipeline.execute({
      systemPrompt: '', userMessage: '', conversationHistory: [], metadata: {},
    });
    expect(result.metadata.active).toBe(true);

    // Deactivate
    registry.deactivate('test-plugin');
    expect(registry.getPluginState('test-plugin')).toBe('inactive');

    result = await pipeline.execute({
      systemPrompt: '', userMessage: '', conversationHistory: [], metadata: {},
    });
    expect(result.metadata.active).toBeUndefined();

    // Activate
    registry.activate('test-plugin');
    expect(registry.getPluginState('test-plugin')).toBe('active');

    result = await pipeline.execute({
      systemPrompt: '', userMessage: '', conversationHistory: [], metadata: {},
    });
    expect(result.metadata.active).toBe(true);

    // Uninstall
    await registry.uninstall('test-plugin');
    expect(registry.getPluginState('test-plugin')).toBe('not-found');

    // Verify all lifecycle events were emitted
    const eventNames = events.map((e) => e.event);
    expect(eventNames).toContain('plugin:installed');
    expect(eventNames).toContain('plugin:deactivated');
    expect(eventNames).toContain('plugin:activated');
    expect(eventNames).toContain('plugin:uninstalled');
  });
});
