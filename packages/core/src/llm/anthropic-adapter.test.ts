/**
 * Unit tests for AnthropicAdapter
 *
 * @module @guidekit/core/llm
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicAdapter } from './anthropic-adapter.js';
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

describe('AnthropicAdapter', () => {
  let adapter: AnthropicAdapter;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    adapter = new AnthropicAdapter({
      provider: 'anthropic',
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
    it('formats tools with Anthropic input_schema structure', () => {
      const result = adapter.formatTools(mockTools) as Array<{
        name: string;
        description: string;
        input_schema: {
          type: string;
          properties: Record<string, unknown>;
          required: string[];
        };
      }>;

      expect(result).toHaveLength(2);

      expect(result[0]).toEqual({
        name: 'highlight',
        description: 'Highlight an element',
        input_schema: {
          type: 'object',
          properties: { selector: { type: 'string', description: 'CSS selector' } },
          required: ['selector'],
        },
      });

      expect(result[1]).toEqual({
        name: 'scrollTo',
        description: 'Scroll to a section',
        input_schema: {
          type: 'object',
          properties: { sectionId: { type: 'string', description: 'Section ID' } },
          required: ['sectionId'],
        },
      });
    });

    it('returns undefined for empty array', () => {
      expect(adapter.formatTools([])).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // formatConversation()
  // -----------------------------------------------------------------------

  describe('formatConversation()', () => {
    it('maps turns correctly', () => {
      const result = adapter.formatConversation(mockHistory);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(result[1]).toEqual({ role: 'assistant', content: 'Hi there!' });
    });

    it('merges adjacent same-role turns with \\n\\n', () => {
      const turns: ConversationTurn[] = [
        { role: 'user', content: 'First message', timestamp: 1 },
        { role: 'user', content: 'Second message', timestamp: 2 },
        { role: 'assistant', content: 'Response', timestamp: 3 },
      ];
      const result = adapter.formatConversation(turns);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        role: 'user',
        content: 'First message\n\nSecond message',
      });
      expect(result[1]).toEqual({
        role: 'assistant',
        content: 'Response',
      });
    });

    it('returns empty array for empty history', () => {
      expect(adapter.formatConversation([])).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // parseResponse() — Text streaming
  // -----------------------------------------------------------------------

  describe('parseResponse() — text streaming', () => {
    it('yields text chunks from content_block_delta text_delta events', async () => {
      const stream = createSSEStream([
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello "}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world!"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
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

    it('yields done chunk on message_delta with stop_reason end_turn', async () => {
      const stream = createSSEStream([
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_2","type":"message","role":"assistant","usage":{"input_tokens":5,"output_tokens":0}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Done"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]);

      const items = await collect(adapter.parseResponse(stream));
      const lastTextChunk = items
        .filter((i): i is TextChunk => 'done' in i)
        .pop();

      expect(lastTextChunk).toBeDefined();
      expect(lastTextChunk!.done).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // parseResponse() — Tool use blocks
  // -----------------------------------------------------------------------

  describe('parseResponse() — tool use blocks', () => {
    it('accumulates input_json_delta and yields ToolCall on content_block_stop', async () => {
      const stream = createSSEStream([
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_3","type":"message","role":"assistant","usage":{"input_tokens":20,"output_tokens":0}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"highlight"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"sel"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"ector\\":\\"#hero\\"}"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":15}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]);

      const items = await collect(adapter.parseResponse(stream));
      const toolCalls = items.filter(
        (i): i is ToolCall => 'name' in i && 'arguments' in i && !('done' in i),
      );

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]!.id).toBe('toolu_01');
      expect(toolCalls[0]!.name).toBe('highlight');
      expect(toolCalls[0]!.arguments).toEqual({ selector: '#hero' });
    });

    it('handles multiple content blocks (text + tool)', async () => {
      const stream = createSSEStream([
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_4","type":"message","role":"assistant","usage":{"input_tokens":25,"output_tokens":0}}}\n\n',
        // Text block
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Let me help."}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        // Tool use block
        'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_02","name":"scrollTo"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"sectionId\\":\\"top\\"}"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":20}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]);

      const items = await collect(adapter.parseResponse(stream));
      const textChunks = items.filter(
        (i): i is TextChunk => 'done' in i,
      );
      const toolCalls = items.filter(
        (i): i is ToolCall => 'name' in i && 'arguments' in i && !('done' in i),
      );

      expect(textChunks).toHaveLength(2);
      expect(textChunks[0]!.text).toBe('Let me help.');
      expect(textChunks[1]).toEqual({ text: '', done: true });

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]!.name).toBe('scrollTo');
      expect(toolCalls[0]!.arguments).toEqual({ sectionId: 'top' });
    });

    it('yields done chunk when stop_reason is tool_use', async () => {
      const stream = createSSEStream([
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_tu","type":"message","role":"assistant","usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_99","name":"highlight"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"selector\\":\\"#hero\\"}"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
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
    it('extracts usage from message_start (input) and message_delta (output)', async () => {
      const stream = createSSEStream([
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_5","type":"message","role":"assistant","usage":{"input_tokens":42,"output_tokens":0}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
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
    it('returns user message with tool_result content block', () => {
      const result = adapter.formatToolResult('toolu_01', { success: true });

      expect(result).toEqual({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_01',
            content: JSON.stringify({ success: true }),
          },
        ],
      });
    });
  });

  // -----------------------------------------------------------------------
  // isContentFiltered()
  // -----------------------------------------------------------------------

  describe('isContentFiltered()', () => {
    it('returns false for normal stop reasons (end_turn, tool_use, max_tokens)', () => {
      expect(
        adapter.isContentFiltered({ delta: { stop_reason: 'end_turn' } }),
      ).toBe(false);
      expect(
        adapter.isContentFiltered({ delta: { stop_reason: 'tool_use' } }),
      ).toBe(false);
      expect(
        adapter.isContentFiltered({ delta: { stop_reason: 'max_tokens' } }),
      ).toBe(false);
      expect(
        adapter.isContentFiltered({ delta: { stop_reason: 'stop_sequence' } }),
      ).toBe(false);
    });

    it('returns true for unknown stop reasons', () => {
      expect(
        adapter.isContentFiltered({ delta: { stop_reason: 'content_policy' } }),
      ).toBe(true);
      expect(
        adapter.isContentFiltered({ delta: { stop_reason: 'safety' } }),
      ).toBe(true);
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
  // max_tokens default and override
  // -----------------------------------------------------------------------

  describe('max_tokens default and override', () => {
    it('uses default 4096 when not specified, custom value when provided', async () => {
      // Test default (4096)
      const defaultMockFetch = vi.fn().mockResolvedValue(
        new Response(
          createSSEStream([
            'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_d","type":"message","role":"assistant","usage":{"input_tokens":5,"output_tokens":0}}}\n\n',
            'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
            'event: message_stop\ndata: {"type":"message_stop"}\n\n',
          ]),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
      );
      globalThis.fetch = defaultMockFetch;

      await adapter.streamRequest({
        systemPrompt: 'System',
        contents: [],
        userMessage: 'Hi',
      });

      const defaultBody = JSON.parse(
        defaultMockFetch.mock.calls[0][1].body as string,
      ) as Record<string, unknown>;
      expect(defaultBody.max_tokens).toBe(4096);

      // Test custom value (8192)
      const customAdapter = new AnthropicAdapter({
        provider: 'anthropic',
        apiKey: 'test-key',
        maxTokens: 8192,
      });

      const customMockFetch = vi.fn().mockResolvedValue(
        new Response(
          createSSEStream([
            'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_c","type":"message","role":"assistant","usage":{"input_tokens":5,"output_tokens":0}}}\n\n',
            'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
            'event: message_stop\ndata: {"type":"message_stop"}\n\n',
          ]),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
      );
      globalThis.fetch = customMockFetch;

      await customAdapter.streamRequest({
        systemPrompt: 'System',
        contents: [],
        userMessage: 'Hi',
      });

      const customBody = JSON.parse(
        customMockFetch.mock.calls[0][1].body as string,
      ) as Record<string, unknown>;
      expect(customBody.max_tokens).toBe(8192);
    });
  });
});
