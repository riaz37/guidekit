import { describe, it, expect } from 'vitest';
import { definePlugin } from './define-plugin.js';
import { ConfigurationError } from '@guidekit/core';

function createTestPlugin(overrides: Partial<Parameters<typeof definePlugin>[0]> = {}) {
  return definePlugin({
    name: 'test-plugin',
    version: '1.0.0',
    setup: () => {},
    ...overrides,
  });
}

describe('definePlugin', () => {
  it('returns a frozen PluginDefinition with correct __brand', () => {
    const plugin = createTestPlugin();
    expect(plugin.__brand).toBe('GuideKitPlugin');
    expect(Object.isFrozen(plugin)).toBe(true);
  });

  it('metadata is frozen with name, version, description, dependencies', () => {
    const plugin = createTestPlugin({
      description: 'A test plugin',
      dependencies: ['dep-a'],
    });
    expect(Object.isFrozen(plugin.metadata)).toBe(true);
    expect(plugin.metadata.name).toBe('test-plugin');
    expect(plugin.metadata.version).toBe('1.0.0');
    expect(plugin.metadata.description).toBe('A test plugin');
    expect(plugin.metadata.dependencies).toEqual(['dep-a']);
  });

  it('hooks default to empty object when not provided', () => {
    const plugin = createTestPlugin();
    expect(plugin.hooks).toEqual({});
    expect(Object.isFrozen(plugin.hooks)).toBe(true);
  });

  it('throws ConfigurationError for empty name', () => {
    expect(() => createTestPlugin({ name: '' })).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError for whitespace in name', () => {
    expect(() => createTestPlugin({ name: 'bad name' })).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError for invalid version', () => {
    expect(() => createTestPlugin({ version: 'abc' })).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError for non-function setup', () => {
    expect(() =>
      definePlugin({
        name: 'bad-setup',
        version: '1.0.0',
        setup: 'not-a-function' as unknown as () => void,
      }),
    ).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError for unknown hook keys', () => {
    expect(() =>
      createTestPlugin({
        hooks: { unknownHook: async (ctx: unknown, next: () => Promise<unknown>) => next() } as never,
      }),
    ).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError for non-function hook values', () => {
    expect(() =>
      createTestPlugin({
        hooks: { beforeLLMCall: 'not-a-function' as never },
      }),
    ).toThrow(ConfigurationError);
  });

  it('valid plugin with all hooks passes', () => {
    const plugin = createTestPlugin({
      hooks: {
        beforeLLMCall: async (ctx, next) => next(),
        afterLLMCall: async (ctx, next) => next(),
        beforeToolExecution: async (ctx, next) => next(),
        afterToolExecution: async (ctx, next) => next(),
        onError: async (ctx, next) => next(),
      },
    });
    expect(plugin.__brand).toBe('GuideKitPlugin');
    expect(Object.isFrozen(plugin.hooks)).toBe(true);
  });
});
