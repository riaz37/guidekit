/**
 * @module @guidekit/core/llm/proxy-adapter
 *
 * LLM adapter that routes requests through a server-side proxy using
 * session JWT auth — no provider API keys in the browser.
 */

import type { LLMProviderAdapter, ToolDefinition, ConversationTurn, TextChunk, ToolCall } from '../types/index.js';
import { AuthenticationError, NetworkError, ErrorCodes } from '../errors/index.js';
import { GeminiAdapter } from './index.js';

export interface ProxyLLMAdapterOptions {
  /** Server proxy URL (e.g. /api/guidekit/llm) */
  endpoint: string;
  /** Returns current session JWT */
  getToken: () => string | null;
  provider: 'gemini' | 'openai' | 'anthropic';
  model?: string;
  /** Inner adapter for format/parse (defaults to Gemini) */
  inner?: LLMProviderAdapter;
}

/**
 * Wraps a provider adapter but sends `streamRequest` to the GuideKit server proxy.
 */
export class ProxyLLMAdapter implements LLMProviderAdapter {
  private readonly inner: LLMProviderAdapter;
  private readonly endpoint: string;
  private readonly getToken: () => string | null;
  private readonly provider: 'gemini' | 'openai' | 'anthropic';
  private readonly model?: string;

  constructor(options: ProxyLLMAdapterOptions) {
    this.endpoint = options.endpoint;
    this.getToken = options.getToken;
    this.provider = options.provider;
    this.model = options.model;
    const geminiModel =
      options.model === 'gemini-2.5-pro' ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
    this.inner =
      options.inner ??
      new GeminiAdapter({ apiKey: 'proxy', provider: 'gemini', model: geminiModel });
  }

  formatTools(tools: ToolDefinition[]): unknown {
    return this.inner.formatTools(tools);
  }

  formatConversation(history: ConversationTurn[]): unknown {
    return this.inner.formatConversation(history);
  }

  parseResponse(stream: ReadableStream): AsyncIterable<TextChunk | ToolCall> {
    return this.inner.parseResponse(stream);
  }

  formatToolResult(callId: string, result: unknown): unknown {
    return this.inner.formatToolResult(callId, result);
  }

  isContentFiltered(chunk: Record<string, unknown>): boolean {
    return this.inner.isContentFiltered(chunk);
  }

  extractUsage(chunk: Record<string, unknown>): { prompt: number; completion: number; total: number } | null {
    return this.inner.extractUsage(chunk);
  }

  async streamRequest(params: {
    systemPrompt: string;
    contents: unknown;
    userMessage?: string;
    tools?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<{ stream: ReadableStream<Uint8Array>; response: Response }> {
    const token = this.getToken();
    if (!token) {
      throw new AuthenticationError({
        code: ErrorCodes.AUTH_EXPIRED_TOKEN,
        message: 'Session token required for proxy LLM requests.',
        suggestion: 'Ensure tokenEndpoint is configured and init() completed.',
      });
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        provider: this.provider,
        model: this.model,
        systemPrompt: params.systemPrompt,
        contents: params.contents,
        userMessage: params.userMessage,
        tools: params.tools,
        stream: true,
      }),
      signal: params.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new NetworkError({
        code: ErrorCodes.NETWORK_CONNECTION_LOST,
        message: `LLM proxy request failed (${response.status}): ${errorBody}`,
        provider: this.provider,
        suggestion: 'Check server proxy configuration and session token validity.',
      });
    }

    if (!response.body) {
      throw new NetworkError({
        code: ErrorCodes.NETWORK_CONNECTION_LOST,
        message: 'LLM proxy returned empty response body.',
        provider: this.provider,
        suggestion: 'Verify the server LLM proxy supports streaming.',
      });
    }

    return { stream: response.body, response };
  }
}
