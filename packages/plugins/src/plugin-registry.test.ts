import { describe, it, expect, afterEach, vi } from 'vitest';
import { PluginRegistry } from './plugin-registry.js';
import { definePlugin } from './define-plugin.js';
import { PluginError, ErrorCodes } from '@guidekit/core';
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

describe('PluginRegistry', () => {
  let registry: PluginRegistry;
  let events: Array<{ event: string; data: unknown }>;

  afterEach(async () => {
    if (registry) await registry.destroy();
  });

  it('install() activates plugin and emits plugin:installed', async () => {
    ({ registry, events } = createRegistryWithBus());
    const plugin = createTestPlugin();
    await registry.install(plugin);

    expect(registry.getPluginState('test-plugin')).toBe('active');
    expect(events).toContainEqual({ event: 'plugin:installed', data: { name: 'test-plugin' } });
  });

  it('install() throws PLUGIN_INSTALL_FAILED if setup() throws', async () => {
    ({ registry, events } = createRegistryWithBus());
    const plugin = createTestPlugin({
      name: 'bad-setup',
      setup: () => { throw new Error('setup boom'); },
    });

    await expect(registry.install(plugin)).rejects.toThrow(PluginError);
    await expect(registry.install(plugin)).rejects.toThrow(/setup failed/);
  });

  it('install() throws for duplicate plugin name', async () => {
    ({ registry, events } = createRegistryWithBus());
    const plugin = createTestPlugin();
    await registry.install(plugin);

    const dup = createTestPlugin();
    await expect(registry.install(dup)).rejects.toThrow(PluginError);
    await expect(registry.install(dup)).rejects.toThrow(/already installed/);
  });

  it('install() throws PLUGIN_DEPENDENCY_MISSING when dep not installed', async () => {
    ({ registry, events } = createRegistryWithBus());
    const plugin = createTestPlugin({
      name: 'needs-dep',
      dependencies: ['missing-dep'],
    });

    try {
      await registry.install(plugin);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PluginError);
      expect((err as PluginError).code).toBe(ErrorCodes.PLUGIN_DEPENDENCY_MISSING);
    }
  });

  it('install() resolves dependencies correctly (install dep first, then dependent)', async () => {
    ({ registry, events } = createRegistryWithBus());

    const dep = createTestPlugin({ name: 'dep-a' });
    const main = createTestPlugin({ name: 'main-plugin', dependencies: ['dep-a'] });

    await registry.install(dep);
    await registry.install(main);

    expect(registry.getPluginState('dep-a')).toBe('active');
    expect(registry.getPluginState('main-plugin')).toBe('active');
  });

  it('uninstall() calls cleanup, removes entry, emits plugin:uninstalled', async () => {
    ({ registry, events } = createRegistryWithBus());
    const cleanupFn = vi.fn();
    const plugin = createTestPlugin({
      setup: () => cleanupFn,
    });
    await registry.install(plugin);

    await registry.uninstall('test-plugin');

    expect(cleanupFn).toHaveBeenCalledOnce();
    expect(registry.getPluginState('test-plugin')).toBe('not-found');
    expect(events).toContainEqual({ event: 'plugin:uninstalled', data: { name: 'test-plugin' } });
  });

  it('uninstall() throws if other plugins depend on it', async () => {
    ({ registry, events } = createRegistryWithBus());
    const dep = createTestPlugin({ name: 'dep-a' });
    const main = createTestPlugin({ name: 'main-plugin', dependencies: ['dep-a'] });

    await registry.install(dep);
    await registry.install(main);

    await expect(registry.uninstall('dep-a')).rejects.toThrow(PluginError);
    await expect(registry.uninstall('dep-a')).rejects.toThrow(/depends on it/);
  });

  it('deactivate() sets state to inactive, emits plugin:deactivated', async () => {
    ({ registry, events } = createRegistryWithBus());
    const plugin = createTestPlugin();
    await registry.install(plugin);

    registry.deactivate('test-plugin');

    expect(registry.getPluginState('test-plugin')).toBe('inactive');
    expect(events).toContainEqual({ event: 'plugin:deactivated', data: { name: 'test-plugin' } });
  });

  it('activate() re-activates, emits plugin:activated', async () => {
    ({ registry, events } = createRegistryWithBus());
    const plugin = createTestPlugin();
    await registry.install(plugin);
    registry.deactivate('test-plugin');

    registry.activate('test-plugin');

    expect(registry.getPluginState('test-plugin')).toBe('active');
    expect(events).toContainEqual({ event: 'plugin:activated', data: { name: 'test-plugin' } });
  });

  it('getInstalledPlugins() returns metadata array', async () => {
    ({ registry, events } = createRegistryWithBus());
    await registry.install(createTestPlugin({ name: 'a', version: '1.0.0' }));
    await registry.install(createTestPlugin({ name: 'b', version: '2.0.0' }));

    const plugins = registry.getInstalledPlugins();
    expect(plugins).toHaveLength(2);
    expect(plugins.map((p) => p.name)).toEqual(['a', 'b']);
  });

  it('getPluginState() returns correct states', async () => {
    ({ registry, events } = createRegistryWithBus());
    expect(registry.getPluginState('nonexistent')).toBe('not-found');

    await registry.install(createTestPlugin());
    expect(registry.getPluginState('test-plugin')).toBe('active');

    registry.deactivate('test-plugin');
    expect(registry.getPluginState('test-plugin')).toBe('inactive');
  });

  it('tool conflict: two plugins registering same tool name throws PLUGIN_TOOL_CONFLICT', async () => {
    ({ registry, events } = createRegistryWithBus());

    const toolDef = {
      name: 'shared-tool',
      description: 'A tool',
      parameters: {},
      schemaVersion: 1,
    };

    const pluginA = createTestPlugin({
      name: 'plugin-a',
      setup: (ctx) => {
        ctx.registerTool(toolDef, async () => 'a');
      },
    });

    const pluginB = createTestPlugin({
      name: 'plugin-b',
      setup: (ctx) => {
        ctx.registerTool(toolDef, async () => 'b');
      },
    });

    await registry.install(pluginA);

    try {
      await registry.install(pluginB);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PluginError);
      expect((err as PluginError).code).toBe(ErrorCodes.PLUGIN_INSTALL_FAILED);
    }
  });

  it('destroy() cleans up all plugins', async () => {
    ({ registry, events } = createRegistryWithBus());
    const cleanupA = vi.fn();
    const cleanupB = vi.fn();

    await registry.install(createTestPlugin({ name: 'a', setup: () => cleanupA }));
    await registry.install(createTestPlugin({ name: 'b', setup: () => cleanupB }));

    await registry.destroy();

    expect(cleanupA).toHaveBeenCalledOnce();
    expect(cleanupB).toHaveBeenCalledOnce();
    expect(registry.getInstalledPlugins()).toHaveLength(0);

    // Prevent afterEach from calling destroy again on a cleaned-up registry
    registry = undefined as unknown as PluginRegistry;
  });
});
