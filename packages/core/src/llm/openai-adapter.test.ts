/**
 * Unit tests for OpenAIAdapter
 *
 * @module @guidekit/core/llm
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIAdapter } from './openai-adapter.js';
import {
  AuthenticationError,
  RateLimitError,
  NetworkError,
  TimeoutError,
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
 * Create a mock SSE Response that streams the provided data lines as
 * `data: <json>\n\n` lines, matching the OpenAI SSE wire format.
 */
function createMockSSEResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/**
 * Create an OpenAI SSE JSON chunk with a text delta.
 */
function openaiTextChunk(
  text: string,
  finishReason: string | null = null,
): string {
  return JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [
      {
        index: 0,
        delta: { content: text },
        finish_reason: finishReason,
      },
    ],
  });
}

/**
 * Create an OpenAI SSE JSON chunk with finish_reason 'stop'.
 */
function openaiStopChunk(): string {
  return JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'stop',
      },
    ],
  });
}

/**
 * Create an OpenAI SSE JSON chunk with a tool call delta.
 * First chunk of a tool call carries id and function.name.
 */
function openaiToolCallStartChunk(
  index: number,
  id: string,
  name: string,
  argumentsFragment: string = '',
): string {
  return JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index,
              id,
              type: 'function',
              function: { name, arguments: argumentsFragment },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  });
}

/**
 * Create an OpenAI SSE JSON chunk with a tool call arguments continuation.
 */
function openaiToolCallArgsChunk(
  index: number,
  argumentsFragment: string,
): string {
  return JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index,
              function: { arguments: argumentsFragment },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  });
}

/**
 * Create an OpenAI SSE JSON chunk with finish_reason 'tool_calls'.
 */
function openaiToolCallFinishChunk(): string {
  return JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'tool_calls',
      },
    ],
  });
}

/**
 * Create an OpenAI SSE JSON chunk with content_filter finish reason.
 */
function _openaiContentFilterChunk(): string {
  return JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'content_filter',
      },
    ],
  });
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
    name: 'scrollToSection',
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
// OpenAIAdapter
// ---------------------------------------------------------------------------

describe('OpenAIAdapter', () => {
  let adapter: OpenAIAdapter;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    adapter = new OpenAIAdapter({ apiKey: 'test-key' });
  });

  // -----------------------------------------------------------------------
  // formatConversation()
  // -----------------------------------------------------------------------

  describe('formatConversation()', () => {
    it('maps user role to "user" and assistant role to "assistant"', () => {
      const result = adapter.formatConversation(mockHistory);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        role: 'user',
        content: 'Hello',
      });
      expect(result[1]).toEqual({
        role: 'assistant',
        content: 'Hi there!',
      });
    });

    it('returns empty array for empty history', () => {
      const result = adapter.formatConversation([]);
      expect(result).toEqual([]);
    });

    it('maps consecutive user turns correctly', () => {
      const turns: ConversationTurn[] = [
        { role: 'user', content: 'First', timestamp: 1 },
        { role: 'user', content: 'Second', timestamp: 2 },
      ];
      const result = adapter.formatConversation(turns);

      expect(result[0]!.role).toBe('user');
      expect(result[1]!.role).toBe('user');
    });
  });

  // -----------------------------------------------------------------------
  // formatTools()
  // -----------------------------------------------------------------------

  describe('formatTools()', () => {
    it('converts ToolDefinition[] to OpenAI function tools format with schema wrapper', () => {
      const result = adapter.formatTools(mockTools) as Array<{
        type: string;
        function: {
          name: string;
          description: string;
          parameters: Record<string, unknown>;
        };
      }>;

      expect(result).toHaveLength(2);

      expect(result[0]!.type).toBe('function');
      expect(result[0]!.function.name).toBe('highlight');
      expect(result[0]!.function.description).toBe('Highlight an element');
      expect(result[0]!.function.parameters).toEqual({
        type: 'object',
        properties: { selector: { type: 'string', description: 'CSS selector' } },
        required: ['selector'],
      });

      expect(result[1]!.type).toBe('function');
      expect(result[1]!.function.name).toBe('scrollToSection');
      expect(result[1]!.function.description).toBe('Scroll to a section');
      expect(result[1]!.function.parameters).toEqual({
        type: 'object',
        properties: { sectionId: { type: 'string', description: 'Section ID' } },
        required: ['sectionId'],
      });
    });

    it('returns undefined for empty tools array', () => {
      const result = adapter.formatTools([]);
      expect(result).toBeUndefined();
    });

    it('no-parameter tool produces empty properties and required[]', () => {
      const noParamTool: ToolDefinition[] = [
        {
          name: 'dismissHighlight',
          description: 'Remove the spotlight',
          parameters: {},
          required: [],
          schemaVersion: 1,
        },
      ];
      const result = adapter.formatTools(noParamTool) as Array<{
        function: { parameters: Record<string, unknown> };
      }>;
      expect(result[0]!.function.parameters).toEqual({
        type: 'object',
        properties: {},
        required: [],
      });
    });

    it('uses empty array for required when tool.required is omitted', () => {
      const toolWithoutRequired: ToolDefinition[] = [
        {
          name: 'getVisibleSections',
          description: 'Get visible sections',
          parameters: {},
          schemaVersion: 1,
        },
      ];
      const result = adapter.formatTools(toolWithoutRequired) as Array<{
        function: { parameters: Record<string, unknown> };
      }>;
      expect(result[0]!.function.parameters).toEqual({
        type: 'object',
        properties: {},
        required: [],
      });
    });

    it('does not mutate original tool.parameters', () => {
      const tool: ToolDefinition = {
        name: 'highlight',
        description: 'Highlight',
        parameters: { selector: { type: 'string' } },
        required: [],
        schemaVersion: 1,
      };
      const originalParamKeys = Object.keys(tool.parameters);
      adapter.formatTools([tool]);
      // Original parameters object should be unchanged
      expect(Object.keys(tool.parameters)).toEqual(originalParamKeys);
    });
  });

  // -----------------------------------------------------------------------
  // formatToolResult()
  // -----------------------------------------------------------------------

  describe('formatToolResult()', () => {
    it('formats tool result as OpenAI tool message', () => {
      const result = adapter.formatToolResult('call_abc123', {
        success: true,
      });

      expect(result).toEqual({
        role: 'tool',
        tool_call_id: 'call_abc123',
        content: '{"success":true}',
      });
    });

    it('passes string results directly without double-serializing', () => {
      const result = adapter.formatToolResult('call_xyz', 'Some text result');
      expect(result).toEqual({
        role: 'tool',
        tool_call_id: 'call_xyz',
        content: 'Some text result',
      });
    });

    it('handles null result', () => {
      const result = adapter.formatToolResult('call_null', null);
      expect(result).toEqual({
        role: 'tool',
        tool_call_id: 'call_null',
        content: 'null',
      });
    });
  });

  // -----------------------------------------------------------------------
  // extractUsage()
  // -----------------------------------------------------------------------

  describe('extractUsage()', () => {
    it('extracts usage data from a parsed chunk', () => {
      const parsed = {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
      };
      const usage = adapter.extractUsage(parsed);
      expect(usage).toEqual({ prompt: 100, completion: 50, total: 150 });
    });

    it('returns null when no usage data is present', () => {
      const parsed = { choices: [] };
      const usage = adapter.extractUsage(parsed);
      expect(usage).toBeNull();
    });

    it('handles partial usage data with defaults', () => {
      const parsed = {
        usage: {
          prompt_tokens: 42,
        },
      };
      const usage = adapter.extractUsage(parsed);
      expect(usage).toEqual({ prompt: 42, completion: 0, total: 0 });
    });
  });

  // -----------------------------------------------------------------------
  // isContentFiltered()
  // -----------------------------------------------------------------------

  describe('isContentFiltered()', () => {
    it('detects content_filter finish reason', () => {
      const parsed = {
        choices: [
          { finish_reason: 'content_filter', delta: {} },
        ],
      };
      expect(adapter.isContentFiltered(parsed)).toBe(true);
    });

    it('detects content_filter_results with filtered: true', () => {
      const parsed = {
        choices: [
          {
            finish_reason: null,
            delta: { content: '' },
            content_filter_results: {
              hate: { filtered: false },
              self_harm: { filtered: true },
            },
          },
        ],
      };
      expect(adapter.isContentFiltered(parsed)).toBe(true);
    });

    it('returns false for normal response', () => {
      const parsed = {
        choices: [
          {
            finish_reason: 'stop',
            delta: { content: 'Hello' },
          },
        ],
      };
      expect(adapter.isContentFiltered(parsed)).toBe(false);
    });

    it('returns false for empty choices', () => {
      const parsed = { choices: [] };
      expect(adapter.isContentFiltered(parsed)).toBe(false);
    });

    it('returns false when no choices present', () => {
      const parsed = {};
      expect(adapter.isContentFiltered(parsed)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // parseResponse()
  // -----------------------------------------------------------------------

  describe('parseResponse()', () => {
    it('yields TextChunk objects from SSE stream', async () => {
      const response = createMockSSEResponse([
        openaiTextChunk('Hello '),
        openaiTextChunk('world!'),
        openaiStopChunk(),
      ]);

      const chunks: Array<TextChunk | ToolCall> = [];
      for await (const chunk of adapter.parseResponse(response.body!)) {
        chunks.push(chunk);
      }

      // 'Hello ', 'world!', stop done chunk
      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toEqual({ text: 'Hello ', done: false });
      expect(chunks[1]).toEqual({ text: 'world!', done: false });
      expect(chunks[2]).toEqual({ text: '', done: true });
    });

    it('yields ToolCall objects from tool call chunks', async () => {
      const response = createMockSSEResponse([
        openaiToolCallStartChunk(0, 'call_abc', 'highlight', '{"selec'),
        openaiToolCallArgsChunk(0, 'tor":"#hero"}'),
        openaiToolCallFinishChunk(),
      ]);

      const results: Array<TextChunk | ToolCall> = [];
      for await (const chunk of adapter.parseResponse(response.body!)) {
        results.push(chunk);
      }

      // Should yield the tool call
      const toolCalls = results.filter(
        (r) => 'name' in r && 'arguments' in r,
      ) as ToolCall[];
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]).toEqual({
        id: 'call_abc',
        name: 'highlight',
        arguments: { selector: '#hero' },
      });
    });

    it('handles [DONE] signal and yields final done chunk', async () => {
      const response = createMockSSEResponse([
        openaiTextChunk('Hi'),
        '[DONE]',
      ]);

      const chunks: Array<TextChunk | ToolCall> = [];
      for await (const chunk of adapter.parseResponse(response.body!)) {
        chunks.push(chunk);
      }

      const textChunks = chunks.filter(
        (c) => 'text' in c,
      ) as TextChunk[];
      expect(textChunks.some((c) => c.done === true)).toBe(true);
    });

    it('handles multiple tool calls in a single response', async () => {
      const response = createMockSSEResponse([
        openaiToolCallStartChunk(0, 'call_1', 'highlight', '{"selector":"#a"}'),
        openaiToolCallStartChunk(1, 'call_2', 'scrollToSection', '{"section'),
        openaiToolCallArgsChunk(1, 'Id":"intro"}'),
        openaiToolCallFinishChunk(),
      ]);

      const results: Array<TextChunk | ToolCall> = [];
      for await (const chunk of adapter.parseResponse(response.body!)) {
        results.push(chunk);
      }

      const toolCalls = results.filter(
        (r) => 'name' in r && 'arguments' in r,
      ) as ToolCall[];
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0]!.id).toBe('call_1');
      expect(toolCalls[0]!.name).toBe('highlight');
      expect(toolCalls[0]!.arguments).toEqual({ selector: '#a' });
      expect(toolCalls[1]!.id).toBe('call_2');
      expect(toolCalls[1]!.name).toBe('scrollToSection');
      expect(toolCalls[1]!.arguments).toEqual({ sectionId: 'intro' });
    });

    it('skips malformed JSON chunks silently', async () => {
      const response = createMockSSEResponse([
        'not valid json',
        openaiTextChunk('Valid chunk'),
        openaiStopChunk(),
      ]);

      const chunks: Array<TextChunk | ToolCall> = [];
      for await (const chunk of adapter.parseResponse(response.body!)) {
        chunks.push(chunk);
      }

      const textChunks = chunks.filter(
        (c) => 'text' in c && (c as TextChunk).text !== '',
      ) as TextChunk[];
      expect(textChunks).toHaveLength(1);
      expect(textChunks[0]!.text).toBe('Valid chunk');
    });
  });

  // -----------------------------------------------------------------------
  // streamRequest()
  // -----------------------------------------------------------------------

  describe('streamRequest()', () => {
    it('sends correct request to OpenAI endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockSSEResponse([openaiTextChunk('hi'), openaiStopChunk()]),
      );
      globalThis.fetch = mockFetch;

      await adapter.streamRequest({
        systemPrompt: 'You are helpful.',
        contents: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');

      const headers = options.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-key');
      expect(headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(options.body as string) as Record<string, unknown>;
      expect(body.model).toBe('gpt-4o');
      expect(body.stream).toBe(true);

      const messages = body.messages as Array<{ role: string; content: string }>;
      expect(messages[0]).toEqual({
        role: 'system',
        content: 'You are helpful.',
      });
      expect(messages[1]).toEqual({
        role: 'user',
        content: 'Hello',
      });
    });

    it('includes tools in request body when provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockSSEResponse([openaiStopChunk()]),
      );
      globalThis.fetch = mockFetch;

      const formattedTools = adapter.formatTools(mockTools);
      await adapter.streamRequest({
        systemPrompt: 'System',
        contents: [{ role: 'user', content: 'Test' }],
        tools: formattedTools,
      });

      const body = JSON.parse(
        (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
      ) as Record<string, unknown>;
      expect(body.tools).toBeDefined();
      expect(body.tools).toEqual(formattedTools);
    });

    it('uses custom model when specified', async () => {
      const customAdapter = new OpenAIAdapter({
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
      });

      const mockFetch = vi.fn().mockResolvedValue(
        createMockSSEResponse([openaiStopChunk()]),
      );
      globalThis.fetch = mockFetch;

      await customAdapter.streamRequest({
        systemPrompt: 'System',
        contents: [{ role: 'user', content: 'Test' }],
      });

      const body = JSON.parse(
        (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
      ) as Record<string, unknown>;
      expect(body.model).toBe('gpt-4o-mini');
    });

    // ----- HTTP error handling -----

    it('HTTP 401 throws AuthenticationError', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Unauthorized', { status: 401 }),
      );

      await expect(
        adapter.streamRequest({
          systemPrompt: 'System',
          contents: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow(AuthenticationError);
    });

    it('HTTP 403 throws AuthenticationError', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Forbidden', { status: 403 }),
      );

      await expect(
        adapter.streamRequest({
          systemPrompt: 'System',
          contents: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow(AuthenticationError);
    });

    it('HTTP 429 throws RateLimitError', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Rate limited', {
          status: 429,
          headers: { 'retry-after': '30' },
        }),
      );

      await expect(
        adapter.streamRequest({
          systemPrompt: 'System',
          contents: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow(RateLimitError);
    });

    it('RateLimitError includes retryAfterMs from header', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Rate limited', {
          status: 429,
          headers: { 'retry-after': '60' },
        }),
      );

      try {
        await adapter.streamRequest({
          systemPrompt: 'System',
          contents: [{ role: 'user', content: 'Hello' }],
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        expect((err as RateLimitError).retryAfterMs).toBe(60_000);
      }
    });

    it('RateLimitError defaults to 60s when no retry-after header', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Rate limited', { status: 429 }),
      );

      try {
        await adapter.streamRequest({
          systemPrompt: 'System',
          contents: [{ role: 'user', content: 'Hello' }],
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        expect((err as RateLimitError).retryAfterMs).toBe(60_000);
      }
    });

    it('HTTP 500 throws NetworkError', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Internal Server Error', { status: 500 }),
      );

      await expect(
        adapter.streamRequest({
          systemPrompt: 'System',
          contents: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow(NetworkError);
    });

    it('HTTP 503 throws NetworkError', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Service Unavailable', { status: 503 }),
      );

      await expect(
        adapter.streamRequest({
          systemPrompt: 'System',
          contents: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow(NetworkError);
    });

    it('network error throws NetworkError', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(
        new TypeError('Failed to fetch'),
      );

      await expect(
        adapter.streamRequest({
          systemPrompt: 'System',
          contents: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow(NetworkError);
    });

    it('timeout throws TimeoutError', async () => {
      globalThis.fetch = vi.fn().mockImplementation(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            // Simulate that the request is aborted by the timeout.
            options.signal!.addEventListener('abort', () => {
              const abortError = new DOMException(
                'The operation was aborted.',
                'AbortError',
              );
              reject(abortError);
            });
          }),
      );

      await expect(
        adapter.streamRequest({
          systemPrompt: 'System',
          contents: [{ role: 'user', content: 'Hello' }],
          timeoutMs: 50,
        }),
      ).rejects.toThrow(TimeoutError);
    });

    it('null response body throws NetworkError', async () => {
      const response = new Response(null, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
      // Force body to be null by creating a response with no body
      Object.defineProperty(response, 'body', { value: null });

      globalThis.fetch = vi.fn().mockResolvedValue(response);

      await expect(
        adapter.streamRequest({
          systemPrompt: 'System',
          contents: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow(NetworkError);
    });
  });
});
