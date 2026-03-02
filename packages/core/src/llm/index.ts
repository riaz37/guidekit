// ---------------------------------------------------------------------------
// GuideKit SDK – LLM Orchestrator & Gemini Adapter
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
  ContentFilterError,
  ErrorCodes,
} from '../errors/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_TIMEOUT_MS = 15_000;
const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Gemini safety categories with their corresponding enum names.
 * We apply `BLOCK_ONLY_HIGH` to every category by default so the model
 * is usable for general-purpose assistance without over-blocking.
 */
const DEFAULT_SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
];

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
// GeminiAdapter
// ---------------------------------------------------------------------------

/**
 * Adapter that translates between GuideKit's internal types and the
 * Gemini REST API wire format. Handles streaming via SSE, tool formatting,
 * and response parsing.
 */
export class GeminiAdapter implements LLMProviderAdapter {
  private readonly apiKey: string;
  private readonly model: string;

  /**
   * Token usage extracted from the most recent `parseResponse` call.
   * Updated as each SSE chunk is parsed; the final value reflects the
   * cumulative usage metadata sent by Gemini (typically in the last chunk).
   */
  private _lastUsage: TokenUsage = emptyUsage();

  constructor(config: Extract<LLMConfig, { provider: 'gemini' }>) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_GEMINI_MODEL;
  }

  /** Token usage from the most recent parseResponse call. */
  get lastUsage(): TokenUsage {
    return this._lastUsage;
  }

  // -----------------------------------------------------------------------
  // LLMProviderAdapter implementation
  // -----------------------------------------------------------------------

  /**
   * Convert GuideKit tool definitions into Gemini's `functionDeclarations`
   * format, wrapped inside a `tools` array.
   */
  formatTools(tools: ToolDefinition[]): unknown {
    if (tools.length === 0) return undefined;

    return [
      {
        functionDeclarations: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object',
            properties: { ...tool.parameters },
            required: tool.required ?? [],
          },
        })),
      },
    ];
  }

  /**
   * Convert an array of `ConversationTurn` objects into Gemini's `contents`
   * array with `role: 'user' | 'model'`.
   */
  formatConversation(
    history: ConversationTurn[],
  ): Array<{ role: string; parts: Array<{ text: string }> }> {
    return history.map((turn) => ({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.content }],
    }));
  }

  /**
   * Parse a Gemini SSE streaming response into an async iterable of
   * `TextChunk` and `ToolCall` objects.
   *
   * The Gemini `streamGenerateContent?alt=sse` endpoint sends each chunk
   * as a JSON object prefixed by `data: `. We parse line-by-line, extract
   * text parts and function call parts, and yield the appropriate types.
   *
   * This method also:
   * - Detects content filtering and throws `ContentFilterError`.
   * - Tracks token usage (accessible via `lastUsage` after iteration).
   */
  async *parseResponse(
    stream: ReadableStream<Uint8Array>,
  ): AsyncIterable<TextChunk | ToolCall> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    this._lastUsage = emptyUsage();

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
            // Malformed JSON chunk – skip silently.
            continue;
          }

          // Check for content filtering — throws if blocked.
          if (this.isContentFiltered(parsed)) {
            throw new ContentFilterError({
              code: ErrorCodes.CONTENT_FILTER_TRIGGERED,
              message: 'Response was blocked by provider content safety filter.',
              provider: 'gemini',
              suggestion: 'Rephrase your question or adjust safety settings.',
            });
          }

          // Track token usage (usually present in the last chunk).
          const chunkUsage = this.extractUsage(parsed);
          if (chunkUsage) {
            this._lastUsage = chunkUsage;
          }

          yield* this.extractChunks(parsed);
        }
      }

      // Flush any remaining data in the buffer.
      if (buffer.trim().startsWith('data:')) {
        const jsonStr = buffer.trim().slice(5).trim();
        if (jsonStr !== '' && jsonStr !== '[DONE]') {
          try {
            const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

            if (this.isContentFiltered(parsed)) {
              throw new ContentFilterError({
                code: ErrorCodes.CONTENT_FILTER_TRIGGERED,
                message: 'Response was blocked by provider content safety filter.',
                provider: 'gemini',
                suggestion: 'Rephrase your question or adjust safety settings.',
              });
            }

            const chunkUsage = this.extractUsage(parsed);
            if (chunkUsage) {
              this._lastUsage = chunkUsage;
            }

            yield* this.extractChunks(parsed);
          } catch (error: unknown) {
            // Re-throw ContentFilterError, ignore other parse errors.
            if (error instanceof ContentFilterError) throw error;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Format a tool result so it can be sent back to Gemini as a
   * `functionResponse` part.
   */
  formatToolResult(
    callId: string,
    result: unknown,
  ): {
    role: string;
    parts: Array<{
      functionResponse: { name: string; response: { result: unknown } };
    }>;
  } {
    return {
      role: 'function',
      parts: [
        {
          functionResponse: {
            name: callId,
            response: { result },
          },
        },
      ],
    };
  }

  // -----------------------------------------------------------------------
  // Streaming request
  // -----------------------------------------------------------------------

  /**
   * Build and execute a streaming request to the Gemini API.
   * Returns the raw `ReadableStream` for the response body together with
   * the raw Response object.
   *
   * Note: The Gemini API key is passed as a URL query parameter (`key=`).
   * This is inherent to the Gemini REST SSE endpoint design; the key is
   * transmitted over HTTPS so it remains encrypted in transit. (H3)
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
    // Build the full contents array: formatted history + the new user message.
    const contentsArray = params.contents as Array<unknown>;
    const fullContents = params.userMessage
      ? [...contentsArray, { role: 'user', parts: [{ text: params.userMessage }] }]
      : contentsArray;

    const url = `${GEMINI_BASE_URL}/${this.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const body: Record<string, unknown> = {
      systemInstruction: {
        parts: [{ text: params.systemPrompt }],
      },
      contents: fullContents,
      safetySettings: DEFAULT_SAFETY_SETTINGS,
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
      },
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
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          message: `Gemini request timed out after ${timeoutMs}ms`,
          provider: 'gemini',
          recoverable: true,
          suggestion: 'Try again or increase the timeout.',
          operationName: 'gemini.streamGenerateContent',
          timeoutMs,
        });
      }

      throw new NetworkError({
        code: ErrorCodes.NETWORK_CONNECTION_LOST,
        message: `Failed to connect to Gemini API: ${(error as Error).message}`,
        provider: 'gemini',
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
        message: 'Gemini response body is null – streaming unavailable.',
        provider: 'gemini',
        suggestion: 'Retry the request.',
      });
    }

    return { stream: response.body, response };
  }

  // -----------------------------------------------------------------------
  // Public helpers (LLMProviderAdapter interface)
  // -----------------------------------------------------------------------

  /**
   * Extract `TextChunk` and `ToolCall` items from a single parsed Gemini
   * SSE JSON object.
   */
  private *extractChunks(
    parsed: Record<string, unknown>,
  ): Generator<TextChunk | ToolCall> {
    const candidates = parsed.candidates as
      | Array<Record<string, unknown>>
      | undefined;

    if (!candidates || candidates.length === 0) return;

    for (const candidate of candidates) {
      const content = candidate.content as
        | { parts?: Array<Record<string, unknown>> }
        | undefined;

      if (!content?.parts) continue;

      const finishReason = candidate.finishReason as string | undefined;
      const isDone =
        finishReason === 'STOP' || finishReason === 'MAX_TOKENS';

      for (const part of content.parts) {
        // Text part
        if (typeof part.text === 'string') {
          const textChunk: TextChunk = {
            text: part.text,
            done: isDone,
          };
          yield textChunk;
        }

        // Function call part
        if (part.functionCall) {
          const fc = part.functionCall as {
            name: string;
            args?: Record<string, unknown>;
          };
          const toolCall: ToolCall = {
            id: fc.name,
            name: fc.name,
            arguments: fc.args ?? {},
          };
          yield toolCall;
        }
      }
    }
  }

  /**
   * Extract token usage from a parsed Gemini response chunk.
   * Returns `null` if no usage metadata is present.
   */
  extractUsage(parsed: Record<string, unknown>): TokenUsage | null {
    const meta = parsed.usageMetadata as
      | {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        }
      | undefined;

    if (!meta) return null;

    return {
      prompt: meta.promptTokenCount ?? 0,
      completion: meta.candidatesTokenCount ?? 0,
      total: meta.totalTokenCount ?? 0,
    };
  }

  /**
   * Check whether a parsed Gemini chunk indicates the response was
   * blocked by a safety filter.
   */
  isContentFiltered(parsed: Record<string, unknown>): boolean {
    const candidates = parsed.candidates as
      | Array<Record<string, unknown>>
      | undefined;

    if (!candidates || candidates.length === 0) {
      // If there is a promptFeedback.blockReason the response was blocked
      // before generation even started.
      const feedback = parsed.promptFeedback as
        | { blockReason?: string }
        | undefined;
      return feedback?.blockReason != null;
    }

    return candidates.some(
      (c) =>
        c.finishReason === 'SAFETY' ||
        c.finishReason === 'BLOCKED_REASON' ||
        c.finishReason === 'OTHER',
    );
  }

  /**
   * Translate an HTTP error response from Gemini into the appropriate
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
        message: `Gemini API authentication failed (${status}): ${errorBody}`,
        provider: 'gemini',
        suggestion:
          'Verify your Gemini API key is correct and has not expired.',
      });
    }

    if (status === 429) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader
        ? parseInt(retryAfterHeader, 10) * 1000
        : 60_000;

      throw new RateLimitError({
        code: ErrorCodes.RATE_LIMIT_PROVIDER,
        message: `Gemini API rate limit exceeded (429): ${errorBody}`,
        provider: 'gemini',
        recoverable: true,
        suggestion: `Rate limited by Gemini. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`,
        retryAfterMs,
      });
    }

    if (status >= 500) {
      throw new NetworkError({
        code: ErrorCodes.NETWORK_CONNECTION_LOST,
        message: `Gemini API server error (${status}): ${errorBody}`,
        provider: 'gemini',
        suggestion:
          'The Gemini API is experiencing issues. Please try again later.',
      });
    }

    // Fallback for other 4xx errors.
    throw new NetworkError({
      code: ErrorCodes.NETWORK_CONNECTION_LOST,
      message: `Gemini API request failed (${status}): ${errorBody}`,
      provider: 'gemini',
      suggestion: 'Check the request parameters and try again.',
    });
  }
}

// ---------------------------------------------------------------------------
// LLMOrchestrator
// ---------------------------------------------------------------------------

/** Callback options accepted by `LLMOrchestrator`. */
interface OrchestratorCallbacks {
  onChunk?: (chunk: TextChunk) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onTokenUsage?: (usage: TokenUsage) => void;
  onError?: (error: Error) => void;
}

/**
 * High-level orchestrator that manages LLM interactions for the GuideKit SDK.
 *
 * Responsibilities:
 * - Owns the active `LLMProviderAdapter`.
 * - Streams responses from the provider, emitting callbacks for text chunks,
 *   tool calls, and token usage.
 * - Handles content filter retries: if the initial response is blocked, it
 *   retries once with a stripped-down prompt (no tools).
 * - Surfaces all errors through the SDK error hierarchy.
 *
 * The orchestrator is fully adapter-agnostic: all provider-specific logic
 * (SSE parsing, content filter detection, usage extraction) lives in the
 * adapter implementations.
 */
export class LLMOrchestrator {
  private _adapter: LLMProviderAdapter;
  private _config: LLMConfig;
  private readonly debug: boolean;
  private readonly callbacks: OrchestratorCallbacks;

  constructor(options: {
    config: LLMConfig;
    debug?: boolean;
    onChunk?: (chunk: TextChunk) => void;
    onToolCall?: (toolCall: ToolCall) => void;
    onTokenUsage?: (usage: TokenUsage) => void;
    onError?: (error: Error) => void;
  }) {
    this._config = options.config;
    this.debug = options.debug ?? false;
    this.callbacks = {
      onChunk: options.onChunk,
      onToolCall: options.onToolCall,
      onTokenUsage: options.onTokenUsage,
      onError: options.onError,
    };
    this._adapter = this.createAdapter(options.config);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Send a message and stream the response from the LLM.
   *
   * Accumulates text and tool calls from the stream, invoking callbacks
   * as chunks arrive, and returns the complete result once the stream ends.
   */
  async sendMessage(params: {
    systemPrompt: string;
    history: ConversationTurn[];
    userMessage: string;
    tools?: ToolDefinition[];
    signal?: AbortSignal;
  }): Promise<{
    text: string;
    toolCalls: ToolCall[];
    usage: TokenUsage;
  }> {
    try {
      return await this.executeStream(params, /* isRetry */ false);
    } catch (error: unknown) {
      if (error instanceof ContentFilterError) {
        // Retry once without tools (simplified prompt).
        this.log('Content filter triggered – retrying without tools');
        try {
          return await this.executeStream(
            { ...params, tools: undefined },
            /* isRetry */ true,
          );
        } catch (_retryError: unknown) {
          const cfError = new ContentFilterError({
            code: ErrorCodes.CONTENT_FILTER_TRIGGERED,
            message:
              'Response blocked by content safety filter after retry.',
            provider: this.providerName,
            suggestion:
              'Rephrase your question or adjust safety settings.',
          });
          this.callbacks.onError?.(cfError);
          throw cfError;
        }
      }

      // For non-content-filter errors, notify and re-throw.
      if (error instanceof Error) {
        this.callbacks.onError?.(error);
      }
      throw error;
    }
  }

  /**
   * Hot-swap the LLM configuration. Creates a new adapter for the
   * updated provider/model.
   */
  updateConfig(config: LLMConfig): void {
    this._config = config;
    this._adapter = this.createAdapter(config);
    const label = 'provider' in config ? config.provider : 'custom adapter';
    this.log(`Config updated: ${label}`);
  }

  /** Get the current provider adapter. */
  get adapter(): LLMProviderAdapter {
    return this._adapter;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Execute a streaming LLM request and collect the results.
   *
   * This method is fully adapter-agnostic: it delegates streaming,
   * response parsing, content-filter detection, and usage extraction
   * entirely to the active `LLMProviderAdapter`. No provider-specific
   * SSE parsing lives in the orchestrator.
   */
  private async executeStream(
    params: {
      systemPrompt: string;
      history: ConversationTurn[];
      userMessage: string;
      tools?: ToolDefinition[];
      signal?: AbortSignal;
    },
    _isRetry: boolean,
  ): Promise<{
    text: string;
    toolCalls: ToolCall[];
    usage: TokenUsage;
  }> {
    const adapter = this._adapter;

    // Format conversation history via the adapter.
    const historyContents = adapter.formatConversation(params.history);

    // Format tools if provided.
    const tools =
      params.tools && params.tools.length > 0
        ? adapter.formatTools(params.tools)
        : undefined;

    // Execute the streaming request via the adapter.
    // The adapter's streamRequest accepts the formatted history as `contents`
    // and appends the user message internally using `userMessage`.
    const { stream } = await adapter.streamRequest({
      systemPrompt: params.systemPrompt,
      contents: historyContents,
      userMessage: params.userMessage,
      tools,
      signal: params.signal,
    });

    // Parse the stream using the adapter's parseResponse.
    // Content filter detection and usage tracking are handled within
    // the adapter's parseResponse — a ContentFilterError will propagate
    // up naturally from the async iteration.
    let fullText = '';
    const toolCalls: ToolCall[] = [];

    for await (const item of adapter.parseResponse(stream)) {
      if ('name' in item && 'arguments' in item) {
        // ToolCall
        const toolCall = item as ToolCall;
        toolCalls.push(toolCall);
        this.callbacks.onToolCall?.(toolCall);
      } else {
        // TextChunk
        const chunk = item as TextChunk;
        if (chunk.text) {
          fullText += chunk.text;
        }
        this.callbacks.onChunk?.(chunk);
      }
    }

    // Always emit a final "done" chunk to signal stream completion,
    // regardless of whether text was received (M3 fix).
    this.callbacks.onChunk?.({ text: '', done: true });

    // Retrieve token usage from the adapter. The adapter tracks usage
    // internally during parseResponse via the `lastUsage` property.
    let usage: TokenUsage = emptyUsage();
    if ('lastUsage' in adapter) {
      usage = (adapter as unknown as { lastUsage: TokenUsage }).lastUsage;
    }

    // Report token usage.
    if (usage.total > 0) {
      this.callbacks.onTokenUsage?.(usage);
    }

    this.log(
      `Response complete: ${fullText.length} chars, ` +
        `${toolCalls.length} tool calls, ` +
        `${usage.total} tokens`,
    );

    return { text: fullText, toolCalls, usage };
  }

  /**
   * Create the appropriate adapter for the given config.
   *
   * Built-in providers:
   * - `'gemini'` — uses the bundled `GeminiAdapter`.
   *
   * Custom adapters:
   * - Pass `{ adapter: myAdapter }` to use any `LLMProviderAdapter`.
   *   Example: `llm: { adapter: myCustomAdapter }`
   */
  private createAdapter(config: LLMConfig): LLMProviderAdapter {
    // Custom adapter — pass-through.
    if ('adapter' in config) {
      return config.adapter;
    }

    // Built-in providers.
    switch (config.provider) {
      case 'gemini':
        return new GeminiAdapter(config);
      default:
        throw new Error(
          `LLM provider "${(config as { provider: string }).provider}" is not yet supported. ` +
            'Use { adapter: yourAdapter } for custom providers.',
        );
    }
  }

  /** Convenience accessor for the current provider name. */
  private get providerName(): string | undefined {
    if ('provider' in this._config) return this._config.provider;
    return undefined;
  }

  /** Log a debug message if debug mode is enabled. */
  private log(message: string): void {
    if (this.debug) {
      console.debug(`[GuideKit:LLM] ${message}`);
    }
  }
}
