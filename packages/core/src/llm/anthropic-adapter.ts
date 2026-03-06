// ---------------------------------------------------------------------------
// GuideKit SDK – Anthropic Adapter
// ---------------------------------------------------------------------------

import type {
  LLMProviderAdapter,
  ToolDefinition,
  ToolCall,
  TextChunk,
  ConversationTurn,
} from '../types/index.js';

import {
  AuthenticationError,
  RateLimitError,
  NetworkError,
  TimeoutError,
  ContentFilterError,
  ErrorCodes,
} from '../errors/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 15_000;
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

// ---------------------------------------------------------------------------
// Token usage helper
// ---------------------------------------------------------------------------

interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

function emptyUsage(): TokenUsage {
  return { prompt: 0, completion: 0, total: 0 };
}

// ---------------------------------------------------------------------------
// Config type
// ---------------------------------------------------------------------------

export interface AnthropicAdapterConfig {
  provider: 'anthropic';
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// AnthropicAdapter
// ---------------------------------------------------------------------------

/**
 * Adapter that translates between GuideKit's internal types and the
 * Anthropic Messages REST API wire format. Handles streaming via typed
 * SSE events, tool formatting, and response parsing including accumulated
 * tool_use input JSON deltas.
 */
export class AnthropicAdapter implements LLMProviderAdapter {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;

  /**
   * Token usage extracted from the most recent `parseResponse` call.
   * Accumulated from `message_start` (input tokens) and `message_delta`
   * (output tokens) events.
   */
  private _lastUsage: TokenUsage = emptyUsage();

  constructor(config: AnthropicAdapterConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  /** Token usage from the most recent parseResponse call. */
  get lastUsage(): TokenUsage {
    return this._lastUsage;
  }

  // -----------------------------------------------------------------------
  // LLMProviderAdapter implementation
  // -----------------------------------------------------------------------

  /**
   * Convert GuideKit tool definitions into Anthropic's tool format.
   */
  formatTools(tools: ToolDefinition[]): unknown {
    if (tools.length === 0) return undefined;

    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties: { ...tool.parameters },
        required: tool.required ?? [],
      },
    }));
  }

  /**
   * Convert an array of `ConversationTurn` objects into Anthropic's
   * messages format. Anthropic requires strictly alternating user/assistant
   * turns, so adjacent turns with the same role are merged.
   */
  formatConversation(
    history: ConversationTurn[],
  ): Array<{ role: string; content: string }> {
    if (history.length === 0) return [];

    const merged: Array<{ role: string; content: string }> = [];

    for (const turn of history) {
      const last = merged[merged.length - 1];
      if (last && last.role === turn.role) {
        // Merge adjacent same-role turns.
        last.content += '\n\n' + turn.content;
      } else {
        merged.push({
          role: turn.role,
          content: turn.content,
        });
      }
    }

    return merged;
  }

  /**
   * Parse an Anthropic SSE streaming response into an async iterable of
   * `TextChunk` and `ToolCall` objects.
   *
   * Anthropic uses typed SSE events (`event:` + `data:` lines):
   * - `message_start` — contains initial usage info
   * - `content_block_start` — begins a text or tool_use block
   * - `content_block_delta` — text_delta or input_json_delta
   * - `content_block_stop` — ends a content block (tool_use JSON is complete)
   * - `message_delta` — final stop_reason and output usage
   * - `message_stop` — stream is complete
   */
  async *parseResponse(
    stream: ReadableStream<Uint8Array>,
  ): AsyncIterable<TextChunk | ToolCall> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    this._lastUsage = emptyUsage();

    // Track the current SSE event type.
    let currentEventType = '';

    // Track active tool_use blocks: index -> { id, name, inputJson }
    const activeToolBlocks = new Map<
      number,
      { id: string; name: string; inputJson: string }
    >();

    // Track whether the response was stopped by content filter.
    let contentFiltered = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last (possibly incomplete) line in the buffer.
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();

          // Empty lines are SSE event boundaries -- reset event type
          // only after processing.
          if (trimmed === '') {
            currentEventType = '';
            continue;
          }

          // Capture the event type from `event:` lines.
          if (trimmed.startsWith('event:')) {
            currentEventType = trimmed.slice(6).trim();
            continue;
          }

          // Process `data:` lines.
          if (!trimmed.startsWith('data:')) continue;

          const jsonStr = trimmed.slice(5).trim();
          if (jsonStr === '') continue;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(jsonStr) as Record<string, unknown>;
          } catch {
            // Malformed JSON chunk -- skip silently.
            continue;
          }

          yield* this.processEvent(
            currentEventType,
            parsed,
            activeToolBlocks,
            (filtered) => { contentFiltered = filtered; },
          );
        }
      }

      // Flush remaining buffer.
      if (buffer.trim()) {
        const remainingLines = buffer.split('\n');
        for (const line of remainingLines) {
          const trimmed = line.trim();

          if (trimmed.startsWith('event:')) {
            currentEventType = trimmed.slice(6).trim();
            continue;
          }

          if (!trimmed.startsWith('data:')) continue;

          const jsonStr = trimmed.slice(5).trim();
          if (jsonStr === '') continue;

          try {
            const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
            yield* this.processEvent(
              currentEventType,
              parsed,
              activeToolBlocks,
              (filtered) => { contentFiltered = filtered; },
            );
          } catch {
            // Ignore parse errors in buffer flush.
          }
        }
      }

      if (contentFiltered) {
        throw new ContentFilterError({
          code: ErrorCodes.CONTENT_FILTER_TRIGGERED,
          message: 'Response was blocked by provider content safety filter.',
          provider: 'anthropic',
          suggestion: 'Rephrase your question or adjust safety settings.',
        });
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Format a tool result so it can be sent back to Anthropic as a
   * user message containing a `tool_result` content block.
   */
  formatToolResult(
    callId: string,
    result: unknown,
  ): {
    role: string;
    content: Array<{
      type: string;
      tool_use_id: string;
      content: string;
    }>;
  } {
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: callId,
          content: JSON.stringify(result),
        },
      ],
    };
  }

  // -----------------------------------------------------------------------
  // Streaming request
  // -----------------------------------------------------------------------

  /**
   * Build and execute a streaming request to the Anthropic Messages API.
   * Returns the raw `ReadableStream` for the response body together with
   * the raw Response object.
   */
  async streamRequest(params: {
    systemPrompt: string;
    contents: unknown;
    userMessage?: string;
    tools?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<{
    stream: ReadableStream<Uint8Array>;
    response: Response;
  }> {
    // Build the full messages array: formatted history + user message.
    const contentsArray = params.contents as Array<unknown>;
    const messages: unknown[] = [...contentsArray];

    if (params.userMessage) {
      messages.push({ role: 'user', content: params.userMessage });
    }

    const url = `${ANTHROPIC_BASE_URL}/messages`;

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      system: params.systemPrompt,
      messages,
      stream: true,
      temperature: 0.7,
    };

    if (params.tools) {
      body.tools = params.tools;
    }

    const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();

    // Combine the external signal with our timeout signal.
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (params.signal) {
      params.signal.addEventListener(
        'abort',
        () => controller.abort(params.signal!.reason),
        { once: true },
      );
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      if (
        error instanceof DOMException &&
        error.name === 'AbortError'
      ) {
        // Distinguish caller abort from timeout.
        if (params.signal?.aborted) {
          throw error; // Re-throw caller abort as-is.
        }
        throw new TimeoutError({
          code: ErrorCodes.TIMEOUT_LLM_RESPONSE,
          message: `Anthropic request timed out after ${timeoutMs}ms`,
          provider: 'anthropic',
          recoverable: true,
          suggestion: 'Try again or increase the timeout.',
          operationName: 'anthropic.messages',
          timeoutMs,
        });
      }

      throw new NetworkError({
        code: ErrorCodes.NETWORK_CONNECTION_LOST,
        message: `Failed to connect to Anthropic API: ${(error as Error).message}`,
        provider: 'anthropic',
        suggestion: 'Check your network connection and try again.',
        cause: error instanceof Error ? error : undefined,
      });
    }

    clearTimeout(timeoutId);

    // Handle HTTP-level errors.
    if (!response.ok) {
      await this.handleHttpError(response);
    }

    if (!response.body) {
      throw new NetworkError({
        code: ErrorCodes.NETWORK_CONNECTION_LOST,
        message: 'Anthropic response body is null -- streaming unavailable.',
        provider: 'anthropic',
        suggestion: 'Retry the request.',
      });
    }

    return { stream: response.body, response };
  }

  // -----------------------------------------------------------------------
  // Public helpers (LLMProviderAdapter interface)
  // -----------------------------------------------------------------------

  /**
   * Check whether a parsed Anthropic chunk indicates the response was
   * blocked by a content filter.
   *
   * Anthropic does not have a dedicated `content_filter` finish reason like
   * OpenAI; normal completion uses `end_turn` or `tool_use`. Any other
   * stop_reason could indicate filtering or policy violation.
   */
  isContentFiltered(parsed: Record<string, unknown>): boolean {
    // Check in message_delta events for stop_reason.
    const delta = parsed.delta as { stop_reason?: string } | undefined;
    if (delta?.stop_reason) {
      // Normal stop reasons that are NOT content filtering.
      const normalReasons = ['end_turn', 'tool_use', 'max_tokens', 'stop_sequence'];
      if (!normalReasons.includes(delta.stop_reason)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Extract token usage from a parsed Anthropic response chunk.
   * Returns `null` if no usage metadata is present.
   *
   * Usage appears in two places:
   * - `message_start` event: `message.usage.input_tokens`
   * - `message_delta` event: `usage.output_tokens`
   *
   * We merge both into our running total.
   */
  extractUsage(parsed: Record<string, unknown>): TokenUsage | null {
    // message_start event has usage inside the message object.
    const message = parsed.message as
      | { usage?: { input_tokens?: number; output_tokens?: number } }
      | undefined;

    if (message?.usage) {
      const input = message.usage.input_tokens ?? 0;
      const output = message.usage.output_tokens ?? 0;
      return {
        prompt: input,
        completion: output,
        total: input + output,
      };
    }

    // message_delta event has usage at the top level.
    const usage = parsed.usage as
      | { input_tokens?: number; output_tokens?: number }
      | undefined;

    if (usage) {
      // message_delta typically only has output_tokens; merge with existing.
      const output = usage.output_tokens ?? 0;
      return {
        prompt: this._lastUsage.prompt,
        completion: output,
        total: this._lastUsage.prompt + output,
      };
    }

    return null;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Process a single typed SSE event from the Anthropic stream.
   * Yields `TextChunk` and `ToolCall` objects as appropriate.
   */
  private *processEvent(
    eventType: string,
    parsed: Record<string, unknown>,
    activeToolBlocks: Map<
      number,
      { id: string; name: string; inputJson: string }
    >,
    setContentFiltered: (filtered: boolean) => void,
  ): Generator<TextChunk | ToolCall> {
    switch (eventType) {
      case 'message_start': {
        // Extract initial usage (input tokens).
        const usage = this.extractUsage(parsed);
        if (usage) {
          this._lastUsage = usage;
        }
        break;
      }

      case 'content_block_start': {
        const index = parsed.index as number | undefined;
        const contentBlock = parsed.content_block as
          | { type: string; id?: string; name?: string; text?: string }
          | undefined;

        if (contentBlock?.type === 'tool_use' && index != null) {
          // Start accumulating tool_use input JSON.
          activeToolBlocks.set(index, {
            id: contentBlock.id ?? '',
            name: contentBlock.name ?? '',
            inputJson: '',
          });
        }
        break;
      }

      case 'content_block_delta': {
        const index = parsed.index as number | undefined;
        const delta = parsed.delta as
          | { type: string; text?: string; partial_json?: string }
          | undefined;

        if (!delta) break;

        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          // Yield text chunk.
          const textChunk: TextChunk = {
            text: delta.text,
            done: false,
          };
          yield textChunk;
        }

        if (
          delta.type === 'input_json_delta' &&
          typeof delta.partial_json === 'string' &&
          index != null
        ) {
          // Accumulate tool input JSON fragment.
          const toolBlock = activeToolBlocks.get(index);
          if (toolBlock) {
            toolBlock.inputJson += delta.partial_json;
          }
        }
        break;
      }

      case 'content_block_stop': {
        const index = parsed.index as number | undefined;
        if (index == null) break;

        const toolBlock = activeToolBlocks.get(index);
        if (toolBlock) {
          // Tool_use block is complete -- parse accumulated JSON and yield.
          let args: Record<string, unknown> = {};
          try {
            if (toolBlock.inputJson) {
              args = JSON.parse(toolBlock.inputJson) as Record<string, unknown>;
            }
          } catch {
            // If input JSON is malformed, yield with empty args.
          }

          const toolCall: ToolCall = {
            id: toolBlock.id,
            name: toolBlock.name,
            arguments: args,
          };
          yield toolCall;

          activeToolBlocks.delete(index);
        }
        break;
      }

      case 'message_delta': {
        // Check for content filtering via stop_reason.
        if (this.isContentFiltered(parsed)) {
          setContentFiltered(true);
        }

        // Extract final usage (output tokens).
        const usage = this.extractUsage(parsed);
        if (usage) {
          this._lastUsage = usage;
        }

        // Check if this is a normal end -- emit done chunk.
        const delta = parsed.delta as { stop_reason?: string } | undefined;
        if (
          delta?.stop_reason === 'end_turn' ||
          delta?.stop_reason === 'stop_sequence' ||
          delta?.stop_reason === 'tool_use'
        ) {
          const doneChunk: TextChunk = { text: '', done: true };
          yield doneChunk;
        }
        break;
      }

      case 'message_stop': {
        // Stream complete -- nothing extra to yield.
        break;
      }

      default:
        // Unknown event type -- skip silently.
        break;
    }
  }

  /**
   * Translate an HTTP error response from Anthropic into the appropriate
   * GuideKit error class.
   */
  private async handleHttpError(response: Response): Promise<never> {
    let errorBody = '';
    try {
      errorBody = await response.text();
    } catch {
      // Ignore read failure.
    }

    const status = response.status;

    if (status === 401 || status === 403) {
      throw new AuthenticationError({
        code: ErrorCodes.AUTH_INVALID_KEY,
        message: `Anthropic API authentication failed (${status}): ${errorBody}`,
        provider: 'anthropic',
        suggestion:
          'Verify your Anthropic API key is correct and has not expired.',
      });
    }

    if (status === 429) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader
        ? parseInt(retryAfterHeader, 10) * 1000
        : 60_000;

      throw new RateLimitError({
        code: ErrorCodes.RATE_LIMIT_PROVIDER,
        message: `Anthropic API rate limit exceeded (429): ${errorBody}`,
        provider: 'anthropic',
        recoverable: true,
        suggestion: `Rate limited by Anthropic. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`,
        retryAfterMs,
      });
    }

    if (status >= 500) {
      throw new NetworkError({
        code: ErrorCodes.NETWORK_CONNECTION_LOST,
        message: `Anthropic API server error (${status}): ${errorBody}`,
        provider: 'anthropic',
        suggestion:
          'The Anthropic API is experiencing issues. Please try again later.',
      });
    }

    // Fallback for other 4xx errors.
    throw new NetworkError({
      code: ErrorCodes.NETWORK_CONNECTION_LOST,
      message: `Anthropic API request failed (${status}): ${errorBody}`,
      provider: 'anthropic',
      suggestion: 'Check the request parameters and try again.',
    });
  }
}
