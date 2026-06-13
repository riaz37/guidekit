import { ProxyLLMAdapter } from '../llm/proxy-adapter.js';
import { ConfigurationError, ErrorCodes } from '../errors/index.js';
import type { LLMConfig } from '../types/index.js';
import type { GuideKitCoreOptions } from './options.js';

export function resolveLLMConfig(
  options: GuideKitCoreOptions,
  hasTokenManager: boolean,
  getToken: () => string | null,
): LLMConfig | null {
  const llmConfig = options.llm;
  const proxyEndpoint = options.proxy?.llm;

  if (llmConfig && 'adapter' in llmConfig) {
    return llmConfig;
  }

  if (proxyEndpoint && hasTokenManager) {
    const provider =
      llmConfig && 'provider' in llmConfig ? llmConfig.provider : 'gemini';
    const model =
      llmConfig && 'provider' in llmConfig && 'model' in llmConfig
        ? llmConfig.model
        : undefined;

    if (provider === 'gemini' || provider === 'openai' || provider === 'anthropic') {
      return {
        adapter: new ProxyLLMAdapter({
          endpoint: proxyEndpoint,
          getToken,
          provider,
          model: model as string | undefined,
        }),
      };
    }
  }

  if (llmConfig && 'provider' in llmConfig) {
    if (!llmConfig.apiKey) {
      throw new ConfigurationError({
        code: ErrorCodes.CONFIG_MISSING_REQUIRED,
        message: `LLM provider "${llmConfig.provider}" requires apiKey or proxy.llm configuration.`,
        suggestion:
          'Use proxy={{ llm: "/api/guidekit/llm" }} with tokenEndpoint for production, or apiKey for local dev.',
      });
    }
    return llmConfig as LLMConfig;
  }

  return null;
}
