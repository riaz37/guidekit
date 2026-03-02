// ---------------------------------------------------------------------------
// GuideKit SDK – OpenAI Adapter
// ---------------------------------------------------------------------------

import type {
  LLMConfig,
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
  ErrorCodes,
} from '../errors/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const DEFAULT_TIMEOUT_MS = 15_000;
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

// ---------------------------------------------------------------------------
// Token usage helper
// ---------------------------------------------------------------------------

interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

// ---------------------------------------------------------------------------
// OpenAIAdapter
// ---------------------------------------------------------------------------

/**
 * Adapter that translates between GuideKit's internal types and the
 * OpenAI Chat Completions API wire format. Handles streaming via SSE,
 * tool formatting, and response parsing.
 */
export class OpenAIAdapter implements LLMProviderAdapter {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: Extract<LLMConfig, { provider: 'openai' }>) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_OPENAI_MODEL;
  }

  // -----------------------------------------------------------------------
  // LLMProviderAdapter implementation
  // -----------------------------------------------------------------------

  /**
   * Convert GuideKit tool definitions into OpenAI's `tools` format.
   * Each tool is wrapped as `{ type: 'function', function: { name, description, parameters } }`.
   */
  formatTools(tools: ToolDefinition[]): unknown {
    if (tools.length === 0) return undefined;

    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * Convert an array of `ConversationTurn` objects into OpenAI's messages
   * format with `role: 'user' | 'assistant'`.
   */
  formatConversation(
    history: ConversationTurn[],
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    return history.map((turn) => ({
      role: turn.role,
      content: turn.content,
    }));
  }

  /**
   * Parse an OpenAI SSE streaming response into an async iterable of
   * `TextChunk` and `ToolCall` objects.
   *
   * The OpenAI streaming endpoint sends each chunk as a JSON object
   * prefixed by `data: `. The final line is `data: [DONE]`.
   * Text content arrives in `choices[0].delta.content` and tool calls
   * arrive in `choices[0].delta.tool_calls`.
   */
  async *parseResponse(
    stream: ReadableStream<Uint8Array>,
  ): AsyncIterable<TextChunk | ToolCall> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Accumulators for tool calls that arrive incrementally across chunks.
    const pendingToolCalls = new Map<
      number,
      { id: string; name: string; argumentsJson: string }
    >();

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
          if (jsonStr === '' || jsonStr === '[DONE]') {
            if (jsonStr === '[DONE]') {
              // Flush any accumulated tool calls.
              yield* this.flushPendingToolCalls(pendingToolCalls);
              yield { text: '', done: true } as TextChunk;
            }
            continue;
          }

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(jsonStr) as Record<string, unknown>;
          } catch {
            // Malformed JSON chunk -- skip silently.
            continue;
          }

          yield* this.extractChunks(parsed, pendingToolCalls);
        }
      }

      // Flush any remaining data in the buffer.
      if (buffer.trim().startsWith('data:')) {
        const jsonStr = buffer.trim().slice(5).trim();
        if (jsonStr === '[DONE]') {
          yield* this.flushPendingToolCalls(pendingToolCalls);
          yield { text: '', done: true } as TextChunk;
        } else if (jsonStr !== '') {
          try {
            const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
            yield* this.extractChunks(parsed, pendingToolCalls);
          } catch {
            // Ignore trailing malformed data.
          }
        }
      }

      // Flush any remaining tool calls that were not emitted.
      yield* this.flushPendingToolCalls(pendingToolCalls);
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Format a tool result so it can be sent back to OpenAI as a
   * `tool` role message with the `tool_call_id`.
   */
  formatToolResult(
    callId: string,
    result: unknown,
  ): { role: 'tool'; tool_call_id: string; content: string } {
    return {
      role: 'tool',
      tool_call_id: callId,
      content: typeof result === 'string' ? result : JSON.stringify(result),
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
    contents: Array<{ role: string; content: string }>;
    tools?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<{
    stream: ReadableStream<Uint8Array>;
    response: Response;
  }> {
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: params.systemPrompt },
      ...params.contents,
    ];

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
      temperature: 0.7,
      top_p: 0.95,
    };

    if (params.tools) {
      body.tools = params.tools;
    }

    const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();

    // Combine the external signal with our timeout signal.
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (params.signal) {
      // If the caller aborts, propagate to our controller.
      params.signal.addEventListener(
        'abort',
        () => controller.abort(params.signal!.reason),
        { once: true },
      );
    }

    let response: Response;
    try {
      response = await fetch(OPENAI_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
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
        suggestion:
          'Check your network connection and try again.',
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
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Extract `TextChunk` and accumulate `ToolCall` data from a single parsed
   * OpenAI SSE JSON object.
   *
   * OpenAI tool calls arrive incrementally: the first chunk for a tool call
   * carries the `id` and `function.name`, while subsequent chunks append to
   * `function.arguments`. We accumulate these in `pendingToolCalls` and only
   * yield complete `ToolCall` objects when the finish_reason is 'tool_calls'
   * or when flushed.
   */
  private *extractChunks(
    parsed: Record<string, unknown>,
    pendingToolCalls: Map<
      number,
      { id: string; name: string; argumentsJson: string }
    >,
  ): Generator<TextChunk | ToolCall> {
    const choices = parsed.choices as
      | Array<Record<string, unknown>>
      | undefined;

    if (!choices || choices.length === 0) return;

    for (const choice of choices) {
      const delta = choice.delta as Record<string, unknown> | undefined;
      const finishReason = choice.finish_reason as string | null | undefined;

      if (delta) {
        // Handle text content.
        if (typeof delta.content === 'string' && delta.content !== '') {
          yield {
            text: delta.content,
            done: false,
          } as TextChunk;
        }

        // Handle incremental tool calls.
        const toolCallDeltas = delta.tool_calls as
          | Array<{
              index: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>
          | undefined;

        if (toolCallDeltas) {
          for (const tc of toolCallDeltas) {
            const existing = pendingToolCalls.get(tc.index);
            if (existing) {
              // Append to existing tool call.
              if (tc.function?.arguments) {
                existing.argumentsJson += tc.function.arguments;
              }
            } else {
              // Start a new tool call accumulation.
              pendingToolCalls.set(tc.index, {
                id: tc.id ?? '',
                name: tc.function?.name ?? '',
                argumentsJson: tc.function?.arguments ?? '',
              });
            }
          }
        }
      }

      // When finish_reason is 'tool_calls', flush the accumulated tool calls.
      if (finishReason === 'tool_calls') {
        yield* this.flushPendingToolCalls(pendingToolCalls);
      }

      // When finish_reason is 'stop', yield a done text chunk.
      if (finishReason === 'stop') {
        yield { text: '', done: true } as TextChunk;
      }
    }
  }

  /**
   * Flush all accumulated pending tool calls as complete `ToolCall` objects.
   */
  private *flushPendingToolCalls(
    pendingToolCalls: Map<
      number,
      { id: string; name: string; argumentsJson: string }
    >,
  ): Generator<ToolCall> {
    // Sort by index to maintain order.
    const sorted = [...pendingToolCalls.entries()].sort(
      ([a], [b]) => a - b,
    );

    for (const [, tc] of sorted) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.argumentsJson) as Record<string, unknown>;
      } catch {
        // If arguments cannot be parsed, use empty object.
      }

      yield {
        id: tc.id,
        name: tc.name,
        arguments: args,
      } as ToolCall;
    }

    pendingToolCalls.clear();
  }

  /**
   * Extract token usage from a parsed OpenAI response chunk.
   * Usage data typically appears in the final chunk when `stream_options`
   * includes `include_usage`, or in the non-streaming response.
   * Returns `null` if no usage data is present.
   */
  extractUsage(parsed: Record<string, unknown>): TokenUsage | null {
    const usage = parsed.usage as
      | {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        }
      | undefined;

    if (!usage) return null;

    return {
      prompt: usage.prompt_tokens ?? 0,
      completion: usage.completion_tokens ?? 0,
      total: usage.total_tokens ?? 0,
    };
  }

  /**
   * Check whether a parsed OpenAI chunk indicates the response was
   * blocked by a content filter.
   *
   * OpenAI signals content filtering through:
   * - `choices[].finish_reason === 'content_filter'`
   * - `choices[].content_filter_results` with `filtered: true`
   */
  isContentFiltered(parsed: Record<string, unknown>): boolean {
    const choices = parsed.choices as
      | Array<Record<string, unknown>>
      | undefined;

    if (!choices || choices.length === 0) return false;

    return choices.some((choice) => {
      // Check finish_reason.
      if (choice.finish_reason === 'content_filter') return true;

      // Check content_filter_results (Azure OpenAI style).
      const filterResults = choice.content_filter_results as
        | Record<string, { filtered?: boolean }>
        | undefined;

      if (filterResults) {
        return Object.values(filterResults).some((r) => r.filtered === true);
      }

      return false;
    });
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
