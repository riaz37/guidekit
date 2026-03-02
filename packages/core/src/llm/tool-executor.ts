// ---------------------------------------------------------------------------
// GuideKit SDK – Multi-Turn Tool Executor
// ---------------------------------------------------------------------------
//
// Implements a multi-turn tool execution loop that sits between the
// LLMOrchestrator and callers. When the LLM returns tool calls, this
// executor runs them, feeds results back, and repeats until the LLM
// produces a text-only response or the round limit is reached.
// ---------------------------------------------------------------------------

import type {
  ToolDefinition,
  ToolCall,
  ConversationTurn,
} from '../types/index.js';
import type { LLMOrchestrator } from './index.js';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/**
 * A registered handler for a specific tool. The `name` must match the tool
 * definition's `name` field exactly.
 */
export interface ToolHandler {
  name: string;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

/** Options for configuring the ToolExecutor. */
export interface ToolExecutorOptions {
  /** Max number of tool call rounds before forcing text response. Default: 5 */
  maxRounds?: number;
  /** Enable debug logging. */
  debug?: boolean;
  /** Called when a tool is about to be executed. */
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  /** Called when a tool execution completes. */
  onToolResult?: (name: string, result: unknown, durationMs: number) => void;
  /** Called when a tool execution fails. */
  onToolError?: (name: string, error: Error) => void;
}

/** A single executed tool call with its outcome. */
export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  durationMs: number;
  error?: string;
}

/** Aggregated token usage across all rounds. */
export interface AggregatedUsage {
  prompt: number;
  completion: number;
  total: number;
}

/** The complete result of a multi-turn tool execution session. */
export interface ToolExecutionResult {
  /** The final text response from the LLM. */
  text: string;
  /** All tool calls that were executed across every round. */
  toolCallsExecuted: ToolCallRecord[];
  /** Accumulated token usage across all LLM calls. */
  totalUsage: AggregatedUsage;
  /** Number of LLM round-trips performed. */
  rounds: number;
}

// ---------------------------------------------------------------------------
// Internal types for tool-augmented conversation turns
// ---------------------------------------------------------------------------

/**
 * Internally, the tool executor needs richer turn types than the public
 * `ConversationTurn` (which only supports 'user' | 'assistant'). These
 * extended types carry tool call metadata and tool results so that each
 * LLM provider adapter can format them correctly.
 */
interface AssistantToolCallTurn {
  role: 'assistant';
  content: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  timestamp: number;
}

interface ToolResultTurn {
  role: 'tool';
  content: string;
  toolCallId: string;
  toolName: string;
  timestamp: number;
}

/**
 * A conversation turn that may be a standard turn, an assistant turn
 * with tool calls, or a tool result turn.
 */
type InternalTurn = ConversationTurn | AssistantToolCallTurn | ToolResultTurn;

// ---------------------------------------------------------------------------
// ToolExecutor
// ---------------------------------------------------------------------------

/**
 * Manages multi-turn LLM interactions involving tool calls.
 *
 * Flow:
 * 1. Send the user message to the LLM along with available tool definitions.
 * 2. If the LLM response includes tool calls, execute them in parallel.
 * 3. Feed tool results back to the LLM as additional conversation context.
 * 4. Repeat until the LLM produces a text-only response or `maxRounds`
 *    is exceeded.
 */
export class ToolExecutor {
  private readonly maxRounds: number;
  private readonly debugEnabled: boolean;
  private readonly handlers = new Map<string, ToolHandler>();

  // Callbacks
  private readonly onToolCallCb?: (name: string, args: Record<string, unknown>) => void;
  private readonly onToolResultCb?: (name: string, result: unknown, durationMs: number) => void;
  private readonly onToolErrorCb?: (name: string, error: Error) => void;

  constructor(options?: ToolExecutorOptions) {
    this.maxRounds = options?.maxRounds ?? 5;
    this.debugEnabled = options?.debug ?? false;
    this.onToolCallCb = options?.onToolCall;
    this.onToolResultCb = options?.onToolResult;
    this.onToolErrorCb = options?.onToolError;
  }

  // -----------------------------------------------------------------------
  // Tool registration
  // -----------------------------------------------------------------------

  /** Register a tool handler. Overwrites any existing handler with the same name. */
  registerTool(handler: ToolHandler): void {
    this.handlers.set(handler.name, handler);
    this.log(`Registered tool: ${handler.name}`);
  }

  /** Unregister a tool by name. No-op if the tool is not registered. */
  unregisterTool(name: string): void {
    const deleted = this.handlers.delete(name);
    if (deleted) {
      this.log(`Unregistered tool: ${name}`);
    }
  }

  /** Check whether a tool handler is registered. */
  hasTool(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Build `ToolDefinition[]` from all registered handlers.
   *
   * Since `ToolHandler` only carries `name` and `execute`, the returned
   * definitions have empty descriptions and parameters. Callers that need
   * richer definitions should maintain their own `ToolDefinition[]` and
   * pass them directly to `executeWithTools`.
   */
  getToolDefinitions(): ToolDefinition[] {
    const definitions: ToolDefinition[] = [];
    for (const handler of this.handlers.values()) {
      definitions.push({
        name: handler.name,
        description: '',
        parameters: {},
        schemaVersion: 1,
      });
    }
    return definitions;
  }

  // -----------------------------------------------------------------------
  // Multi-turn execution loop
  // -----------------------------------------------------------------------

  /**
   * Execute a multi-turn conversation with tool calls.
   *
   * The method sends the initial user message to the LLM. If the LLM
   * responds with tool calls, each call is executed in parallel, the
   * results are appended to the conversation, and the updated context
   * is sent back to the LLM. This loop repeats until:
   *
   * - The LLM returns a text-only response (no tool calls), or
   * - `maxRounds` consecutive tool-calling rounds have been exhausted.
   *
   * When `maxRounds` is exceeded the executor returns whatever text the
   * LLM has produced so far (which may be empty).
   */
  async executeWithTools(params: {
    llm: LLMOrchestrator;
    systemPrompt: string;
    history: ConversationTurn[];
    userMessage: string;
    tools: ToolDefinition[];
    signal?: AbortSignal;
  }): Promise<ToolExecutionResult> {
    const { llm, systemPrompt, userMessage, tools, signal } = params;

    // Accumulate results across rounds.
    const allToolCalls: ToolCallRecord[] = [];
    const totalUsage: AggregatedUsage = { prompt: 0, completion: 0, total: 0 };
    let rounds = 0;
    let finalText = '';

    // Build the running conversation. We start with the caller-supplied
    // history and progressively append assistant / tool turns as the
    // loop executes. The initial history uses the standard ConversationTurn
    // type; tool-related turns use our internal extended types.
    const internalHistory: InternalTurn[] = [...params.history];

    // The user message for the *first* round. On subsequent rounds the
    // LLM is called with an empty user message because the new context
    // is conveyed through the tool result turns appended to the history.
    let currentUserMessage = userMessage;

    while (rounds < this.maxRounds) {
      // Check for abort before each round.
      if (signal?.aborted) {
        this.log('Aborted before round ' + (rounds + 1));
        break;
      }

      rounds++;
      this.log(`--- Round ${rounds} ---`);

      // Convert internal history to standard ConversationTurn[] for the
      // LLMOrchestrator, which only understands 'user' | 'assistant' roles.
      const llmHistory = this.flattenHistory(internalHistory);

      // Send to LLM.
      const response = await llm.sendMessage({
        systemPrompt,
        history: llmHistory,
        userMessage: currentUserMessage,
        tools,
        signal,
      });

      // Accumulate token usage.
      totalUsage.prompt += response.usage.prompt;
      totalUsage.completion += response.usage.completion;
      totalUsage.total += response.usage.total;

      // Capture any text the LLM produced alongside tool calls.
      if (response.text) {
        finalText = response.text;
      }

      // If there are no tool calls, we are done.
      if (response.toolCalls.length === 0) {
        this.log(`Round ${rounds}: text-only response, finishing loop`);
        break;
      }

      this.log(
        `Round ${rounds}: ${response.toolCalls.length} tool call(s) received`,
      );

      // Record the assistant turn with its tool calls.
      const assistantTurn: AssistantToolCallTurn = {
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          args: tc.arguments,
        })),
        timestamp: Date.now(),
      };
      internalHistory.push(assistantTurn);

      // Execute all tool calls from this round in parallel.
      const toolResults = await this.executeToolCallsInParallel(
        response.toolCalls,
        signal,
      );

      // Append each tool result as a separate turn and record it.
      for (const tr of toolResults) {
        allToolCalls.push(tr.record);

        const resultTurn: ToolResultTurn = {
          role: 'tool',
          content: JSON.stringify(
            tr.record.error != null
              ? { error: tr.record.error }
              : tr.record.result,
          ),
          toolCallId: tr.toolCallId,
          toolName: tr.record.name,
          timestamp: Date.now(),
        };
        internalHistory.push(resultTurn);
      }

      // On subsequent rounds the new context is carried by the tool
      // result turns, so we send an empty user message.
      currentUserMessage = '';

      // Check abort again before looping.
      if (signal?.aborted) {
        this.log('Aborted after tool execution in round ' + rounds);
        break;
      }
    }

    if (rounds >= this.maxRounds) {
      this.log(
        `Max rounds (${this.maxRounds}) reached. Returning current text.`,
      );
    }

    this.log(
      `Execution complete: ${rounds} round(s), ` +
        `${allToolCalls.length} tool call(s), ` +
        `${totalUsage.total} total tokens`,
    );

    return {
      text: finalText,
      toolCallsExecuted: allToolCalls,
      totalUsage,
      rounds,
    };
  }

  // -----------------------------------------------------------------------
  // Private: execute a single tool call
  // -----------------------------------------------------------------------

  /**
   * Execute a single tool call by looking up the registered handler and
   * invoking it. Returns the result, any error message, and the wall-clock
   * duration in milliseconds.
   */
  private async executeTool(
    toolCall: ToolCall,
  ): Promise<{ result: unknown; error?: string; durationMs: number }> {
    const handler = this.handlers.get(toolCall.name);

    if (!handler) {
      const errorMsg = `Unknown tool: ${toolCall.name}`;
      this.log(errorMsg);
      return { result: undefined, error: errorMsg, durationMs: 0 };
    }

    this.onToolCallCb?.(toolCall.name, toolCall.arguments);

    const startTime = performance.now();

    try {
      const result = await handler.execute(toolCall.arguments);
      const durationMs = Math.round(performance.now() - startTime);

      this.onToolResultCb?.(toolCall.name, result, durationMs);
      this.log(
        `Tool "${toolCall.name}" completed in ${durationMs}ms`,
      );

      return { result, durationMs };
    } catch (err: unknown) {
      const durationMs = Math.round(performance.now() - startTime);
      const error = err instanceof Error ? err : new Error(String(err));

      this.onToolErrorCb?.(toolCall.name, error);
      this.log(
        `Tool "${toolCall.name}" failed after ${durationMs}ms: ${error.message}`,
      );

      return { result: undefined, error: error.message, durationMs };
    }
  }

  // -----------------------------------------------------------------------
  // Private: execute tool calls in parallel
  // -----------------------------------------------------------------------

  /**
   * Execute an array of tool calls concurrently. If the abort signal fires
   * mid-execution, already-started calls run to completion but the results
   * of all settled calls are still returned.
   */
  private async executeToolCallsInParallel(
    toolCalls: ToolCall[],
    signal?: AbortSignal,
  ): Promise<
    Array<{
      toolCallId: string;
      record: ToolCallRecord;
    }>
  > {
    // If already aborted, skip execution entirely.
    if (signal?.aborted) {
      return toolCalls.map((tc) => ({
        toolCallId: tc.id,
        record: {
          name: tc.name,
          args: tc.arguments,
          result: undefined,
          durationMs: 0,
          error: 'Execution aborted',
        },
      }));
    }

    const settled = await Promise.allSettled(
      toolCalls.map(async (tc) => {
        // Check abort before starting each call. Already-queued microtasks
        // will still run, but this avoids starting new work when possible.
        if (signal?.aborted) {
          return {
            toolCallId: tc.id,
            record: {
              name: tc.name,
              args: tc.arguments,
              result: undefined,
              durationMs: 0,
              error: 'Execution aborted',
            } satisfies ToolCallRecord,
          };
        }

        const outcome = await this.executeTool(tc);

        return {
          toolCallId: tc.id,
          record: {
            name: tc.name,
            args: tc.arguments,
            result: outcome.result,
            durationMs: outcome.durationMs,
            ...(outcome.error != null ? { error: outcome.error } : {}),
          } satisfies ToolCallRecord,
        };
      }),
    );

    // Collect results. Rejected promises are converted to error records.
    return settled.map((s, i) => {
      if (s.status === 'fulfilled') {
        return s.value;
      }

      // This branch should be unreachable because executeTool catches all
      // errors, but we handle it defensively.
      const tc = toolCalls[i];
      if (!tc) {
        const errorMsg =
          s.reason instanceof Error ? s.reason.message : String(s.reason);
        return {
          toolCallId: `unknown-${i}`,
          record: {
            name: 'unknown',
            args: {},
            result: undefined,
            durationMs: 0,
            error: errorMsg,
          },
        };
      }
      const errorMsg =
        s.reason instanceof Error ? s.reason.message : String(s.reason);

      return {
        toolCallId: tc.id,
        record: {
          name: tc.name,
          args: tc.arguments,
          result: undefined,
          durationMs: 0,
          error: errorMsg,
        },
      };
    });
  }

  // -----------------------------------------------------------------------
  // Private: flatten internal history for the LLMOrchestrator
  // -----------------------------------------------------------------------

  /**
   * Convert the internal turn representation (which includes 'tool' roles
   * and assistant turns with tool call metadata) into the flat
   * `ConversationTurn[]` that `LLMOrchestrator.sendMessage` expects.
   *
   * Strategy:
   * - Standard `ConversationTurn` objects pass through unchanged.
   * - `AssistantToolCallTurn` objects are converted to an assistant turn
   *   whose content describes the tool calls that were made.
   * - `ToolResultTurn` objects are converted to user turns that report
   *   the tool results so the LLM can incorporate them.
   *
   * This approach works with any LLM provider since it only uses the
   * 'user' | 'assistant' role discriminator.
   */
  private flattenHistory(turns: InternalTurn[]): ConversationTurn[] {
    const flat: ConversationTurn[] = [];

    for (const turn of turns) {
      if (this.isToolResultTurn(turn)) {
        // Encode tool results as user turns so the LLM sees them as
        // new information to process.
        flat.push({
          role: 'user',
          content: `[Tool result for "${turn.toolName}" (id: ${turn.toolCallId})]: ${turn.content}`,
          timestamp: turn.timestamp,
        });
      } else if (this.isAssistantToolCallTurn(turn)) {
        // Encode the assistant's tool call request as an assistant turn.
        const callDescriptions = turn.toolCalls
          .map(
            (tc) =>
              `[Calling tool "${tc.name}" (id: ${tc.id}) with args: ${JSON.stringify(tc.args)}]`,
          )
          .join('\n');

        const content = turn.content
          ? `${turn.content}\n\n${callDescriptions}`
          : callDescriptions;

        flat.push({
          role: 'assistant',
          content,
          timestamp: turn.timestamp,
        });
      } else {
        // Standard ConversationTurn — pass through.
        flat.push(turn);
      }
    }

    return flat;
  }

  // -----------------------------------------------------------------------
  // Type guards
  // -----------------------------------------------------------------------

  private isToolResultTurn(turn: InternalTurn): turn is ToolResultTurn {
    return (turn as ToolResultTurn).role === 'tool';
  }

  private isAssistantToolCallTurn(
    turn: InternalTurn,
  ): turn is AssistantToolCallTurn {
    return (
      turn.role === 'assistant' &&
      Array.isArray((turn as AssistantToolCallTurn).toolCalls)
    );
  }

  // -----------------------------------------------------------------------
  // Debug logging
  // -----------------------------------------------------------------------

  private log(message: string): void {
    if (this.debugEnabled) {
      console.debug(`[GuideKit:ToolExecutor] ${message}`);
    }
  }
}
