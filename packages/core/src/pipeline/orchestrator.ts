/**
 * @module @guidekit/core/pipeline/orchestrator
 *
 * PipelineOrchestrator — composable message flow for GuideKit v2.
 * Extracted from GuideKitCore.sendTextStream; stages are independently extensible.
 */

import type { LLMOrchestrator } from '../llm/index.js';
import { GuideKitError, ConfigurationError, ErrorCodes } from '../errors/index.js';
import type {
  PipelineContext,
  PipelineDependencies,
  PipelineOrchestratorResult,
  PipelineStage,
} from './types.js';
import { PIPELINE_STAGES } from './types.js';
import type { AfterLLMCallCtx } from '../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function createInitialContext(userMessage: string): PipelineContext {
  return {
    userMessage,
    systemPrompt: '',
    pageModel: null,
    knowledgeSection: '',
    responseText: '',
    conversationId: generateUUID(),
    totalTokens: 0,
    toolCallsExecuted: 0,
    rounds: 0,
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// PipelineOrchestrator
// ---------------------------------------------------------------------------

export class PipelineOrchestrator {
  private readonly deps: PipelineDependencies;

  constructor(deps: PipelineDependencies) {
    this.deps = deps;
  }

  /**
   * Validate preconditions synchronously (throws before returning stream).
   */
  validateRequest(message: string): void {
    if (!this.deps.isReady() || !this.deps.llmOrchestrator) {
      throw new ConfigurationError({
        code: ErrorCodes.CONFIG_MISSING_REQUIRED,
        message: 'SDK not initialized or LLM not configured.',
        suggestion: 'Ensure init() has been called and LLM config is provided.',
      });
    }

    if (this.deps.getSendInFlight()) {
      throw new GuideKitError({
        code: 'SEND_IN_FLIGHT',
        message: 'A message is already being processed. Wait for it to complete.',
        recoverable: true,
        suggestion: 'Await the previous sendText() call before sending another message.',
      });
    }

    const maxLen = this.deps.maxMessageLength;
    if (message.length > maxLen) {
      throw new GuideKitError({
        code: 'INPUT_TOO_LONG',
        message: `Message exceeds maximum length of ${maxLen} characters.`,
        recoverable: true,
        suggestion: `Shorten your message to ${maxLen} characters or fewer, or increase maxMessageLength in options.`,
      });
    }

    this.deps.rateLimiter.checkLLMCall();
  }

  /**
   * Execute the full pipeline as a streaming text response.
   */
  sendTextStream(message: string): PipelineOrchestratorResult {
    this.validateRequest(message);
    this.deps.setSendInFlight(true);

    let resolveDone!: (result: import('../types/index.js').StreamResult) => void;
    let rejectDone!: (error: Error) => void;
    const done = new Promise<import('../types/index.js').StreamResult>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });

    const deps = this.deps;
    const llmOrchestrator = deps.llmOrchestrator!;

    async function* generate(): AsyncGenerator<string> {
      let ctx = createInitialContext(message);

      try {
        deps.telemetry?.clear();
        deps.setStreaming(true, '');
        deps.notifyListeners();
        deps.setAgentState({ status: 'processing', transcript: ctx.userMessage });

        deps.contextManager.addTurn({
          role: 'user',
          content: ctx.userMessage,
          timestamp: Date.now(),
        });

        for (const stage of PIPELINE_STAGES) {
          const span = deps.telemetry?.startSpan(stage, {
            conversationId: ctx.conversationId,
          });

          if (stage === 'llm') {
            for await (const chunk of streamLLMChunks(ctx, deps, llmOrchestrator)) {
              if (typeof chunk === 'string') {
                yield chunk;
              } else {
                ctx = chunk;
              }
            }
            if (deps.pluginRegistry?.getPipeline('afterLLMCall').length) {
              const afterCtx = await deps.pluginRegistry
                .getPipeline<AfterLLMCallCtx>('afterLLMCall')
                .execute({
                  responseText: ctx.responseText,
                  toolCalls: [],
                  usage: ctx.totalTokens
                    ? { prompt: 0, completion: 0, total: ctx.totalTokens }
                    : null,
                  metadata: ctx.metadata,
                });
              ctx = {
                ...ctx,
                responseText: afterCtx.responseText,
                metadata: afterCtx.metadata,
              };
            }
            if (span) {
              deps.telemetry?.setAttributes(span, {
                totalTokens: ctx.totalTokens,
                toolCallsExecuted: ctx.toolCallsExecuted,
                rounds: ctx.rounds,
              });
              deps.telemetry?.endSpan(span);
            }
            continue;
          }

          ctx = await runStage(stage, ctx, deps);
          if (span) {
            deps.telemetry?.setAttributes(span, {
              totalTokens: ctx.totalTokens,
              toolCallsExecuted: ctx.toolCallsExecuted,
              rounds: ctx.rounds,
            });
          }
          if (stage === 'validate') {
            deps.bus.emit('validation:complete', {
              confidence: ctx.validation?.confidence,
              issues: ctx.validation?.issues,
            });
          }
          if (span) deps.telemetry?.endSpan(span);
        }

        deps.contextManager.addTurn({
          role: 'assistant',
          content: ctx.responseText,
          timestamp: Date.now(),
        });

        deps.contextManager.saveSession();

        deps.bus.emit('llm:response-end', {
          conversationId: ctx.conversationId,
          totalTokens: ctx.totalTokens,
        });

        deps.setAgentState({ status: 'idle' });

        resolveDone({
          fullText: ctx.responseText,
          totalTokens: ctx.totalTokens,
          toolCallsExecuted: ctx.toolCallsExecuted,
          rounds: ctx.rounds,
          confidence: ctx.validation?.confidence,
          sources: ctx.metadata.sources as string[] | undefined,
        });
      } catch (error) {
        const err =
          error instanceof GuideKitError
            ? error
            : new GuideKitError({
                code: ErrorCodes.UNKNOWN,
                message: error instanceof Error ? error.message : 'Unknown error',
                recoverable: false,
                suggestion: 'Check the console for details.',
              });

        const isPrivacyHookError =
          err instanceof GuideKitError &&
          (err.code === ErrorCodes.PRIVACY_HOOK_CANCELLED ||
            deps.getAgentState().status === 'idle');

        if (!isPrivacyHookError) {
          if (deps.pluginRegistry?.getPipeline('onError').length) {
            try {
              await deps.pluginRegistry.getPipeline('onError').execute({
                error: err,
                phase: 'llm',
                metadata: {},
              });
            } catch {
              // Plugin error handlers must not mask the original error.
            }
          }
          deps.setAgentState({ status: 'error', error: err });
          deps.bus.emit('error', err);
        }
        rejectDone(err);
      } finally {
        deps.setSendInFlight(false);
        deps.setStreaming(false, '');
        deps.notifyListeners();
      }
    }

    return { stream: generate(), done };
  }
}

// ---------------------------------------------------------------------------
// Stage runners
// ---------------------------------------------------------------------------

async function runStage(
  stage: PipelineStage,
  ctx: PipelineContext,
  deps: PipelineDependencies,
): Promise<PipelineContext> {
  switch (stage) {
    case 'scan':
      return { ...ctx, pageModel: deps.getPageModel() };

    case 'enrich':
      if (deps.stageHooks?.enrich) {
        return deps.stageHooks.enrich(ctx);
      }
      return ctx;

    case 'retrieve':
      if (deps.stageHooks?.retrieve) {
        return deps.stageHooks.retrieve(ctx);
      }
      return ctx;

    case 'context':
      return runContextStage(ctx, deps);

    case 'cognize':
      if (deps.stageHooks?.cognize) {
        return deps.stageHooks.cognize(ctx);
      }
      return ctx;

    case 'validate':
      if (deps.stageHooks?.validate) {
        return deps.stageHooks.validate(ctx);
      }
      return ctx;

    case 'render':
      // Core has no UI rendering; state updates happen via deps callbacks.
      return ctx;

    default:
      return ctx;
  }
}

async function runContextStage(
  ctx: PipelineContext,
  deps: PipelineDependencies,
): Promise<PipelineContext> {
  const pageModel = ctx.pageModel ?? deps.getPageModel();
  if (!pageModel) {
    throw new ConfigurationError({
      code: ErrorCodes.CONFIG_MISSING_REQUIRED,
      message: 'No page model available for context assembly.',
      suggestion: 'Ensure DOM scan completed before sending messages.',
    });
  }

  let systemPrompt = deps.contextManager.buildSystemPrompt(
    pageModel,
    deps.getToolDefinitions(),
  );

  if (ctx.knowledgeSection) {
    systemPrompt = `${systemPrompt}\n\n${ctx.knowledgeSection}`;
  }

  if (deps.getExtraContextSections) {
    const extraSections = await deps.getExtraContextSections();
    if (extraSections.length > 0) {
      systemPrompt = `${systemPrompt}\n\n${extraSections.join('\n\n')}`;
    }
  }

  let userMessage = ctx.userMessage;

  if (deps.onBeforeLLMCall) {
    try {
      const hookCtx = await deps.onBeforeLLMCall({
        systemPrompt,
        userMessage,
        conversationHistory: deps.contextManager
          .getHistory()
          .map((t) => ({ role: t.role, content: t.content })),
      });
      systemPrompt = hookCtx.systemPrompt;
      userMessage = hookCtx.userMessage;
    } catch (hookErr) {
      deps.setAgentState({ status: 'idle' });
      const err =
        hookErr instanceof GuideKitError
          ? hookErr
          : new GuideKitError({
              code: ErrorCodes.PRIVACY_HOOK_CANCELLED,
              message:
                hookErr instanceof Error
                  ? hookErr.message
                  : 'onBeforeLLMCall hook cancelled the request.',
              recoverable: true,
              suggestion: 'Check your onBeforeLLMCall implementation.',
            });
      deps.bus.emit('error', err);
      throw err;
    }
  }

  deps.bus.emit('llm:response-start', { conversationId: ctx.conversationId });

  return { ...ctx, pageModel, systemPrompt, userMessage };
}

async function* streamLLMChunks(
  ctx: PipelineContext,
  deps: PipelineDependencies,
  llmOrchestrator: LLMOrchestrator,
): AsyncGenerator<string | PipelineContext> {
  let responseText = '';
  let totalTokens: number;
  let toolCallsExecuted: number;
  let rounds: number;

  const cognitive = ctx.metadata.cognitive as
    | { systemPromptAddition?: string; maxToolRounds?: number }
    | undefined;

  const systemPrompt = cognitive?.systemPromptAddition
    ? `${ctx.systemPrompt}\n\n${cognitive.systemPromptAddition}`
    : ctx.systemPrompt;
  const userMessage = ctx.userMessage;

  const maxToolRounds = cognitive?.maxToolRounds;

  if (deps.toolExecutor) {
    const gen = deps.toolExecutor.executeWithToolsStream({
      llm: llmOrchestrator,
      systemPrompt,
      history: deps.contextManager.getHistory().slice(0, -1),
      userMessage,
      tools: deps.getToolDefinitions(),
      signal: deps.signal,
      maxRounds: maxToolRounds,
    });

    let streamResult = await gen.next();
    while (!streamResult.done) {
      const chunk = streamResult.value;
      responseText += chunk;
      deps.setStreaming(true, responseText);
      deps.notifyListeners();
      yield chunk;
      streamResult = await gen.next();
    }

    const result = streamResult.value;
    totalTokens = result.totalUsage.total;
    toolCallsExecuted = result.toolCallsExecuted.length;
    rounds = result.rounds;
  } else {
    const gen = llmOrchestrator.sendMessageStream({
      systemPrompt,
      history: deps.contextManager.getHistory().slice(0, -1),
      userMessage,
      tools: deps.getToolDefinitions(),
      signal: deps.signal,
    });

    let streamResult = await gen.next();
    while (!streamResult.done) {
      const item = streamResult.value;
      if ('text' in item && typeof item.text === 'string' && item.text) {
        responseText += item.text;
        deps.setStreaming(true, responseText);
        deps.notifyListeners();
        yield item.text;
      }
      streamResult = await gen.next();
    }

    const result = streamResult.value;
    totalTokens = result.usage.total;
    toolCallsExecuted = 0;
    rounds = 1;
  }

  yield {
    ...ctx,
    responseText,
    totalTokens,
    toolCallsExecuted,
    rounds,
  };
}
