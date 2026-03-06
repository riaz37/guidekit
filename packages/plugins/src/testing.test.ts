import { describe, it, expect, afterEach } from 'vitest';
import { createPluginTestHarness, mockPluginContext, assertPluginInstalls } from './testing.js';
import { definePlugin } from './define-plugin.js';
import type { PluginTestHarness } from './testing.js';
import type { PluginDefinition } from '@guidekit/core';

function createTestPlugin(overrides: Partial<Parameters<typeof definePlugin>[0]> = {}): PluginDefinition {
  return definePlugin({
    name: 'test-plugin',
    version: '1.0.0',
    setup: () => {},
    ...overrides,
  });
}

describe('createPluginTestHarness', () => {
  let harness: PluginTestHarness;

  afterEach(async () => {
    if (harness) await harness.destroy();
  });

  it('installs and queries plugins', async () => {
    harness = createPluginTestHarness();
    const plugin = createTestPlugin();
    await harness.install(plugin);

    const events = harness.getEmittedEvents();
    expect(events).toContainEqual({ event: 'plugin:installed', data: { name: 'test-plugin' } });
  });
});

describe('executeHook', () => {
  let harness: PluginTestHarness;

  afterEach(async () => {
    if (harness) await harness.destroy();
  });

  it('runs middleware pipeline', async () => {
    harness = createPluginTestHarness();
    const plugin = createTestPlugin({
      hooks: {
        beforeLLMCall: async (ctx, next) => {
          ctx.metadata.modified = true;
          return next();
        },
      },
    });
    await harness.install(plugin);

    const result = await harness.executeHook('beforeLLMCall', {
      systemPrompt: '',
      userMessage: '',
      conversationHistory: [],
      metadata: {},
    });

    expect(result.metadata.modified).toBe(true);
  });
});

describe('getEmittedEvents', () => {
  it('captures bus events', async () => {
    const harness = createPluginTestHarness();
    await harness.install(createTestPlugin({ name: 'a' }));
    await harness.install(createTestPlugin({ name: 'b' }));

    const events = harness.getEmittedEvents();
    expect(events).toHaveLength(2);
    expect(events[0]!.event).toBe('plugin:installed');
    expect(events[1]!.event).toBe('plugin:installed');
    await harness.destroy();
  });
});

describe('mockPluginContext', () => {
  it('returns usable context with no-ops', () => {
    const ctx = mockPluginContext();
    // All methods should be callable without throwing
    expect(ctx.getAgentState().status).toBe('idle');
    ctx.registerTool(
      { name: 't', description: '', parameters: {}, schemaVersion: 1 },
      async () => null,
    );
    ctx.addContextProvider('cp', () => 'data');
    ctx.log('test');
    const unsub = ctx.bus.on('test', () => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('applies overrides', () => {
    const customRegister = () => { throw new Error('custom'); };
    const ctx = mockPluginContext({
      registerTool: customRegister,
      getAgentState: () => ({ status: 'processing' as const, transcript: 'test' }),
    });
    expect(ctx.getAgentState().status).toBe('processing');
    expect(() =>
      ctx.registerTool(
        { name: 't', description: '', parameters: {}, schemaVersion: 1 },
        async () => null,
      ),
    ).toThrow('custom');
  });
});

describe('assertPluginInstalls', () => {
  it('succeeds for valid plugin', async () => {
    const plugin = createTestPlugin();
    await expect(assertPluginInstalls(plugin)).resolves.toBeUndefined();
  });

  it('throws for invalid plugin', async () => {
    const bad = { __brand: 'wrong' } as unknown as PluginDefinition;
    await expect(assertPluginInstalls(bad)).rejects.toThrow(/failed to install/);
  });
});
