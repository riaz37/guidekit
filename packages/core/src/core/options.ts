import type { PipelineStageHooks } from '../pipeline/index.js';
import type {
  GuideKitProxyConfig,
  AgentConfig,
  ContentMapInput,
  LLMConfig,
  STTConfig,
  TTSConfig,
  GuideKitOptions,
  KnowledgeDocument,
  PluginDefinition,
  GuideKitEvent,
} from '../types/index.js';
import type { GuideKitError } from '../errors/index.js';
import type { BeforeLLMCallContext } from '../pipeline/types.js';

export interface GuideKitCoreOptions {
  tokenEndpoint?: string;
  stt?: STTConfig;
  tts?: TTSConfig;
  llm?: LLMConfig;
  agent?: AgentConfig;
  contentMap?: ContentMapInput;
  options?: GuideKitOptions;
  instanceId?: string;
  rootElement?: HTMLElement;
  onError?: (error: GuideKitError) => void;
  onEvent?: (event: GuideKitEvent) => void;
  onReady?: () => void;
  onBeforeLLMCall?: (
    context: BeforeLLMCallContext,
  ) => BeforeLLMCallContext | Promise<BeforeLLMCallContext>;
  pipelineHooks?: PipelineStageHooks;
  proxy?: GuideKitProxyConfig;
  intelligence?: boolean | { enabled?: boolean; options?: Record<string, unknown> };
  knowledge?: {
    documents?: KnowledgeDocument[];
    engine?: 'bm25' | 'tfidf';
    topK?: number;
  };
  plugins?: PluginDefinition[];
  hallucinationGuard?: boolean;
  /** Enable heuristic cognitive planning. Default: false. */
  cognitive?: boolean;
  /** Optional SPA router for reliable client-side navigation. */
  navigation?: {
    router?: { push: (href: string) => void | Promise<void> };
  };
}
