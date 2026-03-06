/**
 * Unit tests for OpenAIAdapter
 *
 * @module @guidekit/core/llm
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIAdapter } from './openai-adapter.js';
import {
  AuthenticationError,
  RateLimitError,
  NetworkError,
} from '../errors/index.js';
import type {
  ConversationTurn,
  ToolDefinition,
  TextChunk,
  ToolCall,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a ReadableStream<Uint8Array> from an array of raw SSE strings.
 * Each string is enqueued as a separate chunk (mimicking network frames).
 */
function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

/**
 * Create a mock HTTP Response whose body is an SSE stream built from
 * the given raw SSE strings.
 */
function createMockResponse(
  chunks: string[],
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const stream = createSSEStream(chunks);
  return new Response(stream, {
    status,
    headers: { 'content-type': 'text/event-stream', ...headers },
  });
}

/** Collect all yielded items from an async iterable into an array. */
async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iter) {
    items.push(item);
  }
  return items;
}

const mockTools: ToolDefinition[] = [
  {
    name: 'highlight',
    description: 'Highlight an element',
    parameters: {
      selector: { type: 'string', description: 'CSS selector' },
    },
    required: ['selector'],
    schemaVersion: 1,
  },
  {
    name: 'scrollTo',
    description: 'Scroll to a section',
    parameters: {
      sectionId: { type: 'string', description: 'Section ID' },
    },
    required: ['sectionId'],
    schemaVersion: 1,
  },
];

const mockHistory: ConversationTurn[] = [
  { role: 'user', content: 'Hello', timestamp: 1000 },
  { role: 'assistant', content: 'Hi there!', timestamp: 2000 },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenAIAdapter', () => {
  let adapter: OpenAIAdapter;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    adapter = new OpenAIAdapter({
      provider: 'openai',
      apiKey: 'test-key',
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // formatTools()
  // -----------------------------------------------------------------------

  describe('formatTools()', () => {
    it('formats tools with correct OpenAI function-calling structure', () => {
      const result = adapter.formatTools(mockTools) as Array<{
        type: string;
        function: {
          name: string;
          description: string;
          parameters: { type: string; properties: Record<string, unknown>; required: string[] };
        };
      }>;

      expect(result).toHaveLength(2);

      expect(result[0]).toEqual({
        type: 'function',
        function: {
          name: 'highlight',
          description: 'Highlight an element',
          parameters: {
            type: 'object',
            properties: { selector: { type: 'string', description: 'CSS selector' } },
            required: ['selector'],
          },
        },
      });

      expect(result[1]).toEqual({
        type: 'function',
        function: {
          name: 'scrollTo',
          description: 'Scroll to a section',
          parameters: {
            type: 'object',
            properties: { sectionId: { type: 'string', description: 'Section ID' } },
            required: ['sectionId'],
          },
        },
      });
    });

    it('returns undefined for empty tools array', () => {
      expect(adapter.formatTools([])).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // formatConversation()
  // -----------------------------------------------------------------------

  describe('formatConversation()', () => {
    it('maps turns directly — roles are 1:1 for OpenAI', () => {
      const result = adapter.formatConversation(mockHistory);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(result[1]).toEqual({ role: 'assistant', content: 'Hi there!' });
    });

    it('returns empty array for empty history', () => {
      expect(adapter.formatConversation([])).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // parseResponse() — Text streaming
  // -----------------------------------------------------------------------

  describe('parseResponse() — text streaming', () => {
    it('yields text chunks from SSE delta content', async () => {
      const stream = createSSEStream([
        'data: {"choices":[{"delta":{"content":"Hello "},"index":0,"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"content":"world!"},"index":0,"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ]);

      const items = await collect(adapter.parseResponse(stream));

      const textChunks = items.filter(
        (i): i is TextChunk => 'text' in i && 'done' in i,
      );

      expect(textChunks).toHaveLength(3);
      expect(textChunks[0]).toEqual({ text: 'Hello ', done: false });
      expect(textChunks[1]).toEqual({ text: 'world!', done: false });
      expect(textChunks[2]).toEqual({ text: '', done: true });
    });

    it('handles data: [DONE] signal correctly without error', async () => {
      const stream = createSSEStream([
        'data: {"choices":[{"delta":{"content":"Hi"},"index":0,"finish_reason":null}]}\n\n',
        'data: [DONE]\n\n',
      ]);

      const items = await collect(adapter.parseResponse(stream));

      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({ text: 'Hi', done: false });
    });
  });

  // -----------------------------------------------------------------------
  // parseResponse() — Tool call accumulation
  // -----------------------------------------------------------------------

  describe('parseResponse() — tool call accumulation', () => {
    it('accumulates tool call argument deltas across chunks per index', async () => {
      const stream = createSSEStream([
        // First delta: id, name, partial args
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_123","function":{"name":"highlight","arguments":"{\\"sel"}}]},"index":0,"finish_reason":null}]}\n\n',
        // Second delta: more args
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ector\\":\\"#hero\\"}"}}]},"index":0,"finish_reason":null}]}\n\n',
        // Finish
        'data: {"choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ]);

      const items = await collect(adapter.parseResponse(stream));
      const toolCalls = items.filter(
        (i): i is ToolCall => 'name' in i && 'arguments' in i && !('done' in i),
      );

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]!.id).toBe('call_123');
      expect(toolCalls[0]!.name).toBe('highlight');
      expect(toolCalls[0]!.arguments).toEqual({ selector: '#hero' });
    });

    it('yields complete ToolCall objects when finish_reason is tool_calls', async () => {
      const stream = createSSEStream([
        // Two tool calls in parallel
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"highlight","arguments":"{\\"selector\\":\\"#a\\"}"}},{"index":1,"id":"call_b","function":{"name":"scrollTo","arguments":"{\\"sectionId\\":\\"top\\"}"}}]},"index":0,"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ]);

      const items = await collect(adapter.parseResponse(stream));
      const toolCalls = items.filter(
        (i): i is ToolCall => 'name' in i && 'arguments' in i && !('done' in i),
      );

      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0]!.name).toBe('highlight');
      expect(toolCalls[1]!.name).toBe('scrollTo');
      expect(toolCalls[1]!.arguments).toEqual({ sectionId: 'top' });
    });

    it('yields done chunk when finish_reason is tool_calls', async () => {
      const stream = createSSEStream([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_done","function":{"name":"highlight","arguments":"{\\"selector\\":\\"#hero\\"}"}}]},"index":0,"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ]);

      const items = await collect(adapter.parseResponse(stream));
      const doneChunks = items.filter(
        (i): i is TextChunk => 'done' in i && (i as TextChunk).done === true,
      );

      expect(doneChunks).toHaveLength(1);
      expect(doneChunks[0]).toEqual({ text: '', done: true });
    });
  });

  // -----------------------------------------------------------------------
  // parseResponse() — Usage extraction
  // -----------------------------------------------------------------------

  describe('parseResponse() — usage extraction', () => {
    it('extracts prompt_tokens, completion_tokens, total_tokens from final chunk', async () => {
      const stream = createSSEStream([
        'data: {"choices":[{"delta":{"content":"Hi"},"index":0,"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":42,"completion_tokens":10,"total_tokens":52}}\n\n',
        'data: [DONE]\n\n',
      ]);

      await collect(adapter.parseResponse(stream));

      expect(adapter.lastUsage).toEqual({
        prompt: 42,
        completion: 10,
        total: 52,
      });
    });
  });

  // -----------------------------------------------------------------------
  // formatToolResult()
  // -----------------------------------------------------------------------

  describe('formatToolResult()', () => {
    it('returns { role: "tool", tool_call_id, content: JSON.stringify(result) }', () => {
      const result = adapter.formatToolResult('call_123', { success: true });

      expect(result).toEqual({
        role: 'tool',
        tool_call_id: 'call_123',
        content: JSON.stringify({ success: true }),
      });
    });
  });

  // -----------------------------------------------------------------------
  // isContentFiltered()
  // -----------------------------------------------------------------------

  describe('isContentFiltered()', () => {
    it('returns true when finish_reason is content_filter', () => {
      const parsed = {
        choices: [{ finish_reason: 'content_filter', delta: {} }],
      };
      expect(adapter.isContentFiltered(parsed)).toBe(true);
    });

    it('returns false for normal finish reasons', () => {
      expect(
        adapter.isContentFiltered({
          choices: [{ finish_reason: 'stop', delta: {} }],
        }),
      ).toBe(false);

      expect(
        adapter.isContentFiltered({
          choices: [{ finish_reason: null, delta: {} }],
        }),
      ).toBe(false);

      expect(
        adapter.isContentFiltered({
          choices: [{ finish_reason: 'tool_calls', delta: {} }],
        }),
      ).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // streamRequest() — HTTP errors
  // -----------------------------------------------------------------------

  describe('streamRequest() — HTTP errors', () => {
    it('401 throws AuthenticationError', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Unauthorized', { status: 401 }),
      );

      await expect(
        adapter.streamRequest({
          systemPrompt: 'System',
          contents: [],
          userMessage: 'Hello',
        }),
      ).rejects.toThrow(AuthenticationError);
    });

    it('429 throws RateLimitError', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Rate limited', {
          status: 429,
          headers: { 'retry-after': '30' },
        }),
      );

      await expect(
        adapter.streamRequest({
          systemPrompt: 'System',
          contents: [],
          userMessage: 'Hello',
        }),
      ).rejects.toThrow(RateLimitError);
    });

    it('500 throws NetworkError', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Internal Server Error', { status: 500 }),
      );

      await expect(
        adapter.streamRequest({
          systemPrompt: 'System',
          contents: [],
          userMessage: 'Hello',
        }),
      ).rejects.toThrow(NetworkError);
    });
  });

  // -----------------------------------------------------------------------
  // baseUrl override
  // -----------------------------------------------------------------------

  describe('baseUrl override', () => {
    it('uses custom baseUrl in the fetch call', async () => {
      const customAdapter = new OpenAIAdapter({
        provider: 'openai',
        apiKey: 'test-key',
        baseUrl: 'https://custom.openai.proxy/v1',
      });

      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse([
          'data: {"choices":[{"delta":{"content":"ok"},"index":0,"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      );
      globalThis.fetch = mockFetch;

      await customAdapter.streamRequest({
        systemPrompt: 'System',
        contents: [],
        userMessage: 'Hi',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toBe('https://custom.openai.proxy/v1/chat/completions');
    });
  });
});
