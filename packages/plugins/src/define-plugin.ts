import { ConfigurationError, ErrorCodes } from '@guidekit/core';
import type { PluginDefinition, PluginHooks, PluginContext } from '@guidekit/core';

const VALID_HOOKS: ReadonlySet<keyof PluginHooks> = new Set([
  'beforeLLMCall',
  'afterLLMCall',
  'beforeToolExecution',
  'afterToolExecution',
  'onError',
]);

const SEMVER_LOOSE = /^\d+\.\d+\.\d+/;

export function definePlugin(config: {
  name: string;
  version: string;
  description?: string;
  dependencies?: string[];
  hooks?: Partial<PluginHooks>;
  setup: (ctx: PluginContext) => Promise<(() => void) | void> | ((() => void) | void);
}): PluginDefinition {
  // --- name ---
  if (typeof config.name !== 'string' || !config.name.trim() || /\s/.test(config.name)) {
    throw new ConfigurationError({
      code: ErrorCodes.CONFIG_MISSING_REQUIRED,
      message: 'Plugin name must be a non-empty string with no whitespace.',
      suggestion: 'Provide a valid plugin name, e.g. "my-plugin".',
    });
  }

  // --- version ---
  if (typeof config.version !== 'string' || !SEMVER_LOOSE.test(config.version)) {
    throw new ConfigurationError({
      code: ErrorCodes.CONFIG_MISSING_REQUIRED,
      message: `Plugin version "${String(config.version)}" does not match semver pattern (x.y.z).`,
      suggestion: 'Use a semver-compatible version string, e.g. "1.0.0".',
    });
  }

  // --- setup ---
  if (typeof config.setup !== 'function') {
    throw new ConfigurationError({
      code: ErrorCodes.CONFIG_MISSING_REQUIRED,
      message: 'Plugin setup must be a function.',
      suggestion: 'Provide a setup(ctx) function that initialises your plugin.',
    });
  }

  // --- hooks ---
  if (config.hooks) {
    for (const key of Object.keys(config.hooks)) {
      if (!VALID_HOOKS.has(key as keyof PluginHooks)) {
        throw new ConfigurationError({
          code: ErrorCodes.CONFIG_INVALID_PROVIDER,
          message: `Unknown plugin hook "${key}".`,
          suggestion: `Valid hooks: ${[...VALID_HOOKS].join(', ')}.`,
        });
      }
      if (typeof (config.hooks as Record<string, unknown>)[key] !== 'function') {
        throw new ConfigurationError({
          code: ErrorCodes.CONFIG_INVALID_PROVIDER,
          message: `Plugin hook "${key}" must be a function.`,
          suggestion: 'Each hook value must be a middleware function (ctx, next) => ctx.',
        });
      }
    }
  }

  return Object.freeze({
    __brand: 'GuideKitPlugin' as const,
    metadata: Object.freeze({
      name: config.name,
      version: config.version,
      description: config.description,
      dependencies: config.dependencies,
    }),
    hooks: Object.freeze(config.hooks ?? {}),
    setup: config.setup,
  });
}
