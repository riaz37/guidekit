import type { PipelineOrchestrator } from '../pipeline/index.js';
import type { PlatformExtensionResult } from '../pipeline/extensions.js';
import type { PipelineStageHooks } from '../pipeline/index.js';
import type { ContextManager } from '../context/index.js';
import type { LLMOrchestrator } from '../llm/index.js';
import type { ToolExecutor } from '../llm/tool-executor.js';
import type { RateLimiter } from '../llm/rate-limiter.js';
import type { EventBus } from '../bus/index.js';
import type { AgentState, PageModel, ToolDefinition } from '../types/index.js';
import type { PipelineTelemetry } from '../telemetry/index.js';
import type { BeforeLLMCallContext } from '../pipeline/types.js';
import { createPipelineOrchestrator, mergeStageHooks } from './pipeline-factory.js';

export interface PipelineSetupContext {
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
  getPageModel: () => PageModel | null;
  getToolDefinitions: () => ToolDefinition[];
  platformExtensions: PlatformExtensionResult | null;
  pipelineHooks?: PipelineStageHooks;
  onBeforeLLMCall?: (
    ctx: BeforeLLMCallContext,
  ) => BeforeLLMCallContext | Promise<BeforeLLMCallContext>;
  setAgentState: (state: AgentState) => void;
  getAgentState: () => AgentState;
  setStreaming: (isStreaming: boolean, text: string) => void;
  notifyListeners: () => void;
  telemetry: PipelineTelemetry;
}

export function setupPipelineOrchestrator(ctx: PipelineSetupContext): PipelineOrchestrator {
  return createPipelineOrchestrator({
    llmOrchestrator: ctx.llmOrchestrator,
    toolExecutor: ctx.toolExecutor,
    contextManager: ctx.contextManager,
    rateLimiter: ctx.rateLimiter,
    bus: ctx.bus,
    signal: ctx.signal,
    maxMessageLength: ctx.maxMessageLength,
    isReady: ctx.isReady,
    getSendInFlight: ctx.getSendInFlight,
    setSendInFlight: ctx.setSendInFlight,
    getPageModel: ctx.getPageModel,
    getToolDefinitions: ctx.getToolDefinitions,
    onBeforeLLMCall: async (context) => {
      let hookCtx = context;
      const registry = ctx.platformExtensions?.pluginRegistry;
      if (registry) {
        const pipeline = registry.getPipeline<
          typeof context & { metadata: Record<string, unknown> }
        >('beforeLLMCall');
        if (pipeline.length > 0) {
          hookCtx = await pipeline.execute({ ...hookCtx, metadata: {} });
        }
      }
      if (ctx.onBeforeLLMCall) {
        hookCtx = await ctx.onBeforeLLMCall(hookCtx);
      }
      return hookCtx;
    },
    setAgentState: ctx.setAgentState,
    getAgentState: ctx.getAgentState,
    setStreaming: ctx.setStreaming,
    notifyListeners: ctx.notifyListeners,
    stageHooks: mergeStageHooks(ctx.platformExtensions?.stageHooks, ctx.pipelineHooks),
    telemetry: ctx.telemetry,
    getExtraContextSections: ctx.platformExtensions?.getExtraContextSections,
    pluginRegistry: ctx.platformExtensions?.pluginRegistry ?? null,
  });
}
