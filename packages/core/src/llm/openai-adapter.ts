// ---------------------------------------------------------------------------
// GuideKit SDK – OpenAI Adapter
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

const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = 15_000;

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

export interface OpenAIAdapterConfig {
  provider: 'openai';
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// OpenAIAdapter
// ---------------------------------------------------------------------------

/**
 * Adapter that translates between GuideKit's internal types and the
 * OpenAI Chat Completions REST API wire format. Handles streaming via SSE,
 * tool formatting, and response parsing including streamed tool call deltas.
 */
export class OpenAIAdapter implements LLMProviderAdapter {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  /**
   * Token usage extracted from the most recent `parseResponse` call.
   * Updated when the final SSE chunk includes usage data (requires
   * `stream_options: { include_usage: true }`).
   */
  private _lastUsage: TokenUsage = emptyUsage();

  constructor(config: OpenAIAdapterConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_OPENAI_MODEL;
    this.baseUrl = config.baseUrl ?? DEFAULT_OPENAI_BASE_URL;
  }

  /** Token usage from the most recent parseResponse call. */
  get lastUsage(): TokenUsage {
    return this._lastUsage;
  }

  // -----------------------------------------------------------------------
  // LLMProviderAdapter implementation
  // -----------------------------------------------------------------------

  /**
   * Convert GuideKit tool definitions into OpenAI's function-calling format.
   */
  formatTools(tools: ToolDefinition[]): unknown {
    if (tools.length === 0) return undefined;

    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: { ...tool.parameters },
          required: tool.required ?? [],
        },
      },
    }));
  }

  /**
   * Convert an array of `ConversationTurn` objects into OpenAI's messages
   * format with `role: 'user' | 'assistant'`.
   */
  formatConversation(
    history: ConversationTurn[],
  ): Array<{ role: string; content: string }> {
    return history.map((turn) => ({
      role: turn.role,
      content: turn.content,
    }));
  }

  /**
   * Parse an OpenAI SSE streaming response into an async iterable of
   * `TextChunk` and `ToolCall` objects.
   *
   * OpenAI streams tool calls as deltas: each chunk may contain
   * `choices[0].delta.tool_calls[i]` with partial `arguments`. We
   * accumulate these fragments per tool call index and yield complete
   * `ToolCall` objects when `finish_reason === 'tool_calls'` or the
   * stream ends.
   */
  async *parseResponse(
    stream: ReadableStream<Uint8Array>,
  ): AsyncIterable<TextChunk | ToolCall> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    this._lastUsage = emptyUsage();

    // Accumulated tool call state: index -> { id, name, arguments }
    const toolCallAccumulator = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let pendingToolCalls = false;

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

          // SSE lines that are not data payloads.
          if (!trimmed.startsWith('data:')) continue;

          const jsonStr = trimmed.slice(5).trim();
          if (jsonStr === '' || jsonStr === '[DONE]') continue;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(jsonStr) as Record<string, unknown>;
          } catch {
            // Malformed JSON chunk -- skip silently.
            continue;
          }

          // Check for content filtering.
          if (this.isContentFiltered(parsed)) {
            // Yield any accumulated tool calls before throwing.
            yield* this.flushToolCalls(toolCallAccumulator);
            throw new ContentFilterError({
              code: ErrorCodes.CONTENT_FILTER_TRIGGERED,
              message: 'Response was blocked by provider content safety filter.',
              provider: 'openai',
              suggestion: 'Rephrase your question or adjust safety settings.',
            });
          }

          // Track token usage (present in the final chunk with stream_options).
          const chunkUsage = this.extractUsage(parsed);
          if (chunkUsage) {
            this._lastUsage = chunkUsage;
          }

          // Extract text and tool call deltas from this chunk.
          const choices = parsed.choices as
            | Array<Record<string, unknown>>
            | undefined;

          if (!choices || choices.length === 0) continue;

          const choice = choices[0]!;
          const delta = choice.delta as Record<string, unknown> | undefined;
          const finishReason = choice.finish_reason as string | null | undefined;

          if (delta) {
            // Text content delta.
            if (typeof delta.content === 'string' && delta.content.length > 0) {
              const textChunk: TextChunk = {
                text: delta.content,
                done: false,
              };
              yield textChunk;
            }

            // Tool call deltas.
            const toolCalls = delta.tool_calls as
              | Array<{
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>
              | undefined;

            if (toolCalls) {
              pendingToolCalls = true;
              for (const tc of toolCalls) {
                const existing = toolCallAccumulator.get(tc.index);
                if (existing) {
                  // Append argument fragment.
                  if (tc.function?.arguments) {
                    existing.arguments += tc.function.arguments;
                  }
                } else {
                  // First delta for this index -- capture id and name.
                  toolCallAccumulator.set(tc.index, {
                    id: tc.id ?? '',
                    name: tc.function?.name ?? '',
                    arguments: tc.function?.arguments ?? '',
                  });
                }
              }
            }
          }

          // When finish_reason signals tool_calls are complete, flush them.
          if (finishReason === 'tool_calls' && pendingToolCalls) {
            yield* this.flushToolCalls(toolCallAccumulator);
            pendingToolCalls = false;
          }

          // Emit a done text chunk when the stream signals stop.
          if (finishReason === 'stop' || finishReason === 'tool_calls') {
            const doneChunk: TextChunk = { text: '', done: true };
            yield doneChunk;
          }
        }
      }

      // Flush remaining buffer.
      if (buffer.trim().startsWith('data:')) {
        const jsonStr = buffer.trim().slice(5).trim();
        if (jsonStr !== '' && jsonStr !== '[DONE]') {
          try {
            const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

            if (this.isContentFiltered(parsed)) {
              yield* this.flushToolCalls(toolCallAccumulator);
              throw new ContentFilterError({
                code: ErrorCodes.CONTENT_FILTER_TRIGGERED,
                message: 'Response was blocked by provider content safety filter.',
                provider: 'openai',
                suggestion: 'Rephrase your question or adjust safety settings.',
              });
            }

            const chunkUsage = this.extractUsage(parsed);
            if (chunkUsage) {
              this._lastUsage = chunkUsage;
            }
          } catch (error: unknown) {
            if (error instanceof ContentFilterError) throw error;
          }
        }
      }

      // Flush any remaining accumulated tool calls at stream end.
      if (pendingToolCalls) {
        yield* this.flushToolCalls(toolCallAccumulator);
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Format a tool result so it can be sent back to OpenAI as a
   * tool response message.
   */
  formatToolResult(
    callId: string,
    result: unknown,
  ): { role: string; tool_call_id: string; content: string } {
    return {
      role: 'tool',
      tool_call_id: callId,
      content: JSON.stringify(result),
    };
  }

  // -----------------------------------------------------------------------
  // Streaming request
  // -----------------------------------------------------------------------

  /**
   * Build and execute a streaming request to the OpenAI Chat Completions API.
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
    // Build the full messages array: system + formatted history + user message.
    const contentsArray = params.contents as Array<unknown>;
    const messages: unknown[] = [
      { role: 'system', content: params.systemPrompt },
      ...contentsArray,
    ];

    if (params.userMessage) {
      messages.push({ role: 'user', content: params.userMessage });
    }

    const url = `${this.baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
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
          'Authorization': `Bearer ${this.apiKey}`,
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
          message: `OpenAI request timed out after ${timeoutMs}ms`,
          provider: 'openai',
          recoverable: true,
          suggestion: 'Try again or increase the timeout.',
          operationName: 'openai.chatCompletions',
          timeoutMs,
        });
      }

      throw new NetworkError({
        code: ErrorCodes.NETWORK_CONNECTION_LOST,
        message: `Failed to connect to OpenAI API: ${(error as Error).message}`,
        provider: 'openai',
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
        message: 'OpenAI response body is null -- streaming unavailable.',
        provider: 'openai',
        suggestion: 'Retry the request.',
      });
    }

    return { stream: response.body, response };
  }

  // -----------------------------------------------------------------------
  // Public helpers (LLMProviderAdapter interface)
  // -----------------------------------------------------------------------

  /**
   * Check whether a parsed OpenAI chunk indicates the response was
   * blocked by a content filter.
   */
  isContentFiltered(parsed: Record<string, unknown>): boolean {
    const choices = parsed.choices as
      | Array<Record<string, unknown>>
      | undefined;

    if (!choices || choices.length === 0) return false;

    return choices.some(
      (c) => c.finish_reason === 'content_filter',
    );
  }

  /**
   * Extract token usage from a parsed OpenAI response chunk.
   * Returns `null` if no usage metadata is present.
   *
   * With `stream_options: { include_usage: true }`, the final chunk
   * includes a `usage` object with `prompt_tokens`, `completion_tokens`,
   * and `total_tokens`.
   */
  extractUsage(parsed: Record<string, unknown>): TokenUsage | null {
    const usage = parsed.usage as
      | {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        }
      | undefined
      | null;

    if (!usage) return null;

    return {
      prompt: usage.prompt_tokens ?? 0,
      completion: usage.completion_tokens ?? 0,
      total: usage.total_tokens ?? 0,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Flush all accumulated tool calls from the map, yielding complete
   * `ToolCall` objects with parsed argument JSON.
   */
  private *flushToolCalls(
    accumulator: Map<number, { id: string; name: string; arguments: string }>,
  ): Generator<ToolCall> {
    // Yield in index order for deterministic output.
    const sortedEntries = [...accumulator.entries()].sort(
      ([a], [b]) => a - b,
    );

    for (const [, tc] of sortedEntries) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.arguments) as Record<string, unknown>;
      } catch {
        // If argument JSON is malformed, yield with empty args.
      }

      const toolCall: ToolCall = {
        id: tc.id,
        name: tc.name,
        arguments: args,
      };
      yield toolCall;
    }

    accumulator.clear();
  }

  /**
   * Translate an HTTP error response from OpenAI into the appropriate
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
        message: `OpenAI API authentication failed (${status}): ${errorBody}`,
        provider: 'openai',
        suggestion:
          'Verify your OpenAI API key is correct and has not expired.',
      });
    }

    if (status === 429) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader
        ? parseInt(retryAfterHeader, 10) * 1000
        : 60_000;

      throw new RateLimitError({
        code: ErrorCodes.RATE_LIMIT_PROVIDER,
        message: `OpenAI API rate limit exceeded (429): ${errorBody}`,
        provider: 'openai',
        recoverable: true,
        suggestion: `Rate limited by OpenAI. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`,
        retryAfterMs,
      });
    }

    if (status >= 500) {
      throw new NetworkError({
        code: ErrorCodes.NETWORK_CONNECTION_LOST,
        message: `OpenAI API server error (${status}): ${errorBody}`,
        provider: 'openai',
        suggestion:
          'The OpenAI API is experiencing issues. Please try again later.',
      });
    }

    // Fallback for other 4xx errors.
    throw new NetworkError({
      code: ErrorCodes.NETWORK_CONNECTION_LOST,
      message: `OpenAI API request failed (${status}): ${errorBody}`,
      provider: 'openai',
      suggestion: 'Check the request parameters and try again.',
    });
  }
}
