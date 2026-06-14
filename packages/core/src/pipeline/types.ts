/**
 * @module @guidekit/core/pipeline/types
 *
 * Typed pipeline context and dependency interfaces for the v2 message flow.
 */

import type { EventBus } from '../bus/index.js';
import type { ContextManager } from '../context/index.js';
import type { LLMOrchestrator } from '../llm/index.js';
import type { ToolExecutor } from '../llm/tool-executor.js';
import type { RateLimiter } from '../llm/rate-limiter.js';
import type {
  PageModel,
  SemanticPageModel,
  ToolDefinition,
  AgentState,
  StreamResult,
  TextStream,
} from '../types/index.js';
import type { GuideKitError } from '../errors/index.js';
import type { PipelineTelemetry } from '../telemetry/index.js';

/** Context passed to onBeforeLLMCall for privacy filtering. */
export interface BeforeLLMCallContext {
  systemPrompt: string;
  userMessage: string;
  conversationHistory: Array<{ role: string; content: string }>;
}

/** Pipeline stages executed in order for each user message. */
export type PipelineStage =
  | 'scan'
  | 'enrich'
  | 'retrieve'
  | 'context'
  | 'cognize'
  | 'llm'
  | 'validate'
  | 'render';

export const PIPELINE_STAGES: readonly PipelineStage[] = [
  'scan',
  'enrich',
  'retrieve',
  'context',
  'cognize',
  'llm',
  'validate',
  'render',
] as const;

/** Mutable context carried through all pipeline stages. */
export interface PipelineContext {
  /** Original user message (may be modified by privacy hooks). */
  userMessage: string;
  /** Assembled system prompt for the LLM. */
  systemPrompt: string;
  /** Current page model (may be enriched to SemanticPageModel). */
  pageModel: PageModel | SemanticPageModel | null;
  /** RAG / knowledge section appended during retrieve stage. */
  knowledgeSection: string;
  /** Accumulated LLM response text. */
  responseText: string;
  /** Conversation identifier for this turn. */
  conversationId: string;
  /** Token usage after LLM stage. */
  totalTokens: number;
  /** Tool calls executed count. */
  toolCallsExecuted: number;
  /** LLM round-trips performed. */
  rounds: number;
  /** Optional validation metadata (hallucination guard, confidence). */
  validation?: {
    confidence?: number;
    issues?: unknown[];
  };
  /** Arbitrary stage metadata for plugins / extensions. */
  metadata: Record<string, unknown>;
}

/** Optional stage hooks for pipeline extensions and custom integrations. */
export interface PipelineStageHooks {
  enrich?: (ctx: PipelineContext) => PipelineContext | Promise<PipelineContext>;
  retrieve?: (ctx: PipelineContext) => PipelineContext | Promise<PipelineContext>;
  cognize?: (ctx: PipelineContext) => PipelineContext | Promise<PipelineContext>;
  validate?: (ctx: PipelineContext) => PipelineContext | Promise<PipelineContext>;
}

/** Dependencies injected from GuideKitCore into the orchestrator. */
export interface PipelineDependencies {
  llmOrchestrator: LLMOrchestrator | null;
  toolExecutor: ToolExecutor | null;
  contextManager: ContextManager;
  rateLimiter: RateLimiter;
  bus: EventBus;
  signal: AbortSignal;
  maxMessageLength: number;
  isReady: () => boolean;
  getSendInFlight: () => boolean;
  setSendInFlight: (value: boolean) => void;
  getPageModel: () => PageModel | SemanticPageModel | null;
  getToolDefinitions: () => ToolDefinition[];
  onBeforeLLMCall?: (
    context: BeforeLLMCallContext,
  ) => BeforeLLMCallContext | Promise<BeforeLLMCallContext>;
  setAgentState: (state: AgentState) => void;
  getAgentState: () => AgentState;
  setStreaming: (isStreaming: boolean, text: string) => void;
  notifyListeners: () => void;
  stageHooks?: PipelineStageHooks;
  telemetry?: PipelineTelemetry;
  getExtraContextSections?: () => Promise<string[]>;
  pluginRegistry?: PluginRegistryLike | null;
}

/** Minimal plugin registry surface used by the pipeline orchestrator. */
export interface PluginRegistryLike {
  getPipeline<T>(hook: string): { execute(ctx: T): Promise<T>; length: number };
}

export interface PipelineOrchestratorResult {
  stream: TextStream['stream'];
  done: Promise<StreamResult>;
}

export type { StreamResult, TextStream, GuideKitError };
