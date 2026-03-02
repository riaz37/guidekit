/**
 * Unit tests for GeminiAdapter and LLMOrchestrator
 *
 * @module @guidekit/core/llm
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiAdapter, LLMOrchestrator } from './index.js';
import { AuthenticationError, RateLimitError, ContentFilterError } from '../errors/index.js';
import type {
  ConversationTurn,
  ToolDefinition,
  TextChunk,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock SSE Response that streams the provided JSON chunks as
 * `data: <json>\n\n` lines, matching the Gemini SSE wire format.
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
 * Create a Gemini SSE JSON chunk with a text part.
 */
function geminiTextChunk(text: string, finishReason?: string): string {
  const candidate: Record<string, unknown> = {
    content: {
      parts: [{ text }],
      role: 'model',
    },
  };
  if (finishReason) {
    candidate.finishReason = finishReason;
  }
  return JSON.stringify({ candidates: [candidate] });
}

/**
 * Create a Gemini SSE JSON chunk that carries token usage metadata.
 */
function geminiUsageChunk(prompt: number, completion: number, total: number): string {
  return JSON.stringify({
    candidates: [
      {
        content: { parts: [{ text: '' }], role: 'model' },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: {
      promptTokenCount: prompt,
      candidatesTokenCount: completion,
      totalTokenCount: total,
    },
  });
}

/**
 * Create a Gemini SSE JSON chunk blocked by safety filter.
 */
function geminiFilteredChunk(): string {
  return JSON.stringify({
    candidates: [
      {
        finishReason: 'SAFETY',
        content: { parts: [], role: 'model' },
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
// GeminiAdapter
// ---------------------------------------------------------------------------

describe('GeminiAdapter', () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    adapter = new GeminiAdapter({ provider: 'gemini', apiKey: 'test-key' });
  });

  describe('formatConversation()', () => {
    it('maps user role to "user" and assistant role to "model"', () => {
      const result = adapter.formatConversation(mockHistory);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        role: 'user',
        parts: [{ text: 'Hello' }],
      });
      expect(result[1]).toEqual({
        role: 'model',
        parts: [{ text: 'Hi there!' }],
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

  describe('formatTools()', () => {
    it('converts ToolDefinition[] to Gemini function declarations with schema wrapper', () => {
      const result = adapter.formatTools(mockTools) as Array<{
        functionDeclarations: Array<{
          name: string;
          description: string;
          parameters: Record<string, unknown>;
        }>;
      }>;

      expect(result).toHaveLength(1);
      expect(result[0]!.functionDeclarations).toHaveLength(2);

      const decl0 = result[0]!.functionDeclarations[0]!;
      expect(decl0.name).toBe('highlight');
      expect(decl0.description).toBe('Highlight an element');
      expect(decl0.parameters).toEqual({
        type: 'object',
        properties: { selector: { type: 'string', description: 'CSS selector' } },
        required: ['selector'],
      });

      const decl1 = result[0]!.functionDeclarations[1]!;
      expect(decl1.name).toBe('scrollToSection');
      expect(decl1.parameters).toEqual({
        type: 'object',
        properties: { sectionId: { type: 'string', description: 'Section ID' } },
        required: ['sectionId'],
      });
    });

    it('returns undefined for empty tools array', () => {
      const result = adapter.formatTools([]);
      expect(result).toBeUndefined();
    });

    it('produces required:[] when tool.required is omitted', () => {
      const tool: ToolDefinition = {
        name: 'getVisibleSections',
        description: 'Get visible sections',
        parameters: {},
        schemaVersion: 1,
      };
      const result = adapter.formatTools([tool]) as Array<{
        functionDeclarations: Array<{ parameters: Record<string, unknown> }>;
      }>;
      expect(result[0]!.functionDeclarations[0]!.parameters).toEqual({
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
      expect(Object.keys(tool.parameters)).toEqual(originalParamKeys);
    });
  });

  describe('formatToolResult()', () => {
    it('formats tool result as Gemini functionResponse', () => {
      const result = adapter.formatToolResult('highlight', { success: true });

      expect(result).toEqual({
        role: 'function',
        parts: [
          {
            functionResponse: {
              name: 'highlight',
              response: { result: { success: true } },
            },
          },
        ],
      });
    });

    it('wraps primitive results correctly', () => {
      const result = adapter.formatToolResult('readContent', 'Some text');
      expect(result.parts[0]!.functionResponse.response.result).toBe('Some text');
    });

    it('handles null result', () => {
      const result = adapter.formatToolResult('noOp', null);
      expect(result.parts[0]!.functionResponse.response.result).toBeNull();
    });
  });

  describe('extractUsage()', () => {
    it('extracts usage metadata from a parsed chunk', () => {
      const parsed = {
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
        },
      };
      const usage = adapter.extractUsage(parsed);
      expect(usage).toEqual({ prompt: 100, completion: 50, total: 150 });
    });

    it('returns null when no usage metadata is present', () => {
      const parsed = { candidates: [] };
      const usage = adapter.extractUsage(parsed);
      expect(usage).toBeNull();
    });
  });

  describe('isContentFiltered()', () => {
    it('detects SAFETY finish reason', () => {
      const parsed = {
        candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }],
      };
      expect(adapter.isContentFiltered(parsed)).toBe(true);
    });

    it('detects promptFeedback blockReason', () => {
      const parsed = {
        promptFeedback: { blockReason: 'SAFETY' },
      };
      expect(adapter.isContentFiltered(parsed)).toBe(true);
    });

    it('returns false for normal response', () => {
      const parsed = {
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: 'Hello' }] },
          },
        ],
      };
      expect(adapter.isContentFiltered(parsed)).toBe(false);
    });
  });

  describe('parseResponse()', () => {
    it('yields TextChunk objects from SSE stream', async () => {
      const response = createMockSSEResponse([
        geminiTextChunk('Hello '),
        geminiTextChunk('world!', 'STOP'),
      ]);

      const chunks: Array<{ text?: string; done?: boolean }> = [];
      for await (const chunk of adapter.parseResponse(response.body!)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toEqual({ text: 'Hello ', done: false });
      expect(chunks[1]).toEqual({ text: 'world!', done: true });
    });

    it('yields ToolCall objects from function call chunks', async () => {
      const fnCallChunk = JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'highlight',
                    args: { selector: '#hero' },
                  },
                },
              ],
              role: 'model',
            },
          },
        ],
      });

      const response = createMockSSEResponse([fnCallChunk]);
      const results: unknown[] = [];
      for await (const chunk of adapter.parseResponse(response.body!)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: 'highlight',
        name: 'highlight',
        arguments: { selector: '#hero' },
      });
    });
  });
});

// ---------------------------------------------------------------------------
// LLMOrchestrator
// ---------------------------------------------------------------------------

describe('LLMOrchestrator', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function createOrchestrator(overrides?: {
    onChunk?: (chunk: TextChunk) => void;
    onTokenUsage?: (usage: { prompt: number; completion: number; total: number }) => void;
    onError?: (error: Error) => void;
  }) {
    return new LLMOrchestrator({
      config: { provider: 'gemini', apiKey: 'test-key' },
      debug: false,
      ...overrides,
    });
  }

  describe('constructor', () => {
    it('validates config and creates adapter for gemini', () => {
      const orchestrator = createOrchestrator();
      expect(orchestrator.adapter).toBeDefined();
    });

    it('throws for unsupported provider', () => {
      expect(
        () =>
          new LLMOrchestrator({
            // @ts-expect-error -- intentionally passing unsupported provider
            config: { provider: 'anthropic', apiKey: 'test-key' },
          }),
      ).toThrow('not yet supported');
    });

    it('accepts a custom adapter via { adapter } config', () => {
      const mockAdapter = new GeminiAdapter({ provider: 'gemini', apiKey: 'test-key' });
      const orchestrator = new LLMOrchestrator({
        config: { adapter: mockAdapter },
      });
      expect(orchestrator.adapter).toBe(mockAdapter);
    });
  });

  describe('sendMessage()', () => {
    it('calls onChunk for each text chunk', async () => {
      const receivedChunks: TextChunk[] = [];
      const orchestrator = createOrchestrator({
        onChunk: (chunk) => receivedChunks.push({ ...chunk }),
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        createMockSSEResponse([
          geminiTextChunk('Hello '),
          geminiTextChunk('world!'),
          geminiUsageChunk(10, 5, 15),
        ]),
      );

      const result = await orchestrator.sendMessage({
        systemPrompt: 'You are helpful.',
        history: [],
        userMessage: 'Hi',
        tools: [],
      });

      expect(result.text).toBe('Hello world!');
      // onChunk should have been called for the text chunks plus a final done chunk
      expect(receivedChunks.length).toBeGreaterThanOrEqual(2);
      expect(receivedChunks.some((c) => c.text === 'Hello ')).toBe(true);
    });

    it('calls onTokenUsage with usage data', async () => {
      let receivedUsage: { prompt: number; completion: number; total: number } | null = null;
      const orchestrator = createOrchestrator({
        onTokenUsage: (usage) => {
          receivedUsage = { ...usage };
        },
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        createMockSSEResponse([
          geminiTextChunk('Response text'),
          geminiUsageChunk(100, 50, 150),
        ]),
      );

      await orchestrator.sendMessage({
        systemPrompt: 'System',
        history: [],
        userMessage: 'Hello',
      });

      expect(receivedUsage).not.toBeNull();
      expect(receivedUsage!.prompt).toBe(100);
      expect(receivedUsage!.completion).toBe(50);
      expect(receivedUsage!.total).toBe(150);
    });

    it('returns accumulated text and tool calls', async () => {
      const fnCallChunk = JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { text: 'Let me highlight that. ' },
                {
                  functionCall: {
                    name: 'highlight',
                    args: { selector: '#hero' },
                  },
                },
              ],
              role: 'model',
            },
          },
        ],
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        createMockSSEResponse([fnCallChunk, geminiUsageChunk(50, 30, 80)]),
      );

      const orchestrator = createOrchestrator();
      const result = await orchestrator.sendMessage({
        systemPrompt: 'System',
        history: [],
        userMessage: 'Highlight the hero',
        tools: mockTools,
      });

      expect(result.text).toContain('Let me highlight that.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]!.name).toBe('highlight');
      expect(result.toolCalls[0]!.arguments).toEqual({ selector: '#hero' });
    });
  });

  describe('HTTP error handling', () => {
    it('HTTP 401 throws AuthenticationError', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Unauthorized', { status: 401 }),
      );

      const orchestrator = createOrchestrator();

      await expect(
        orchestrator.sendMessage({
          systemPrompt: 'System',
          history: [],
          userMessage: 'Hello',
        }),
      ).rejects.toThrow(AuthenticationError);
    });

    it('HTTP 403 throws AuthenticationError', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Forbidden', { status: 403 }),
      );

      const orchestrator = createOrchestrator();

      await expect(
        orchestrator.sendMessage({
          systemPrompt: 'System',
          history: [],
          userMessage: 'Hello',
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

      const orchestrator = createOrchestrator();

      await expect(
        orchestrator.sendMessage({
          systemPrompt: 'System',
          history: [],
          userMessage: 'Hello',
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

      const orchestrator = createOrchestrator();

      try {
        await orchestrator.sendMessage({
          systemPrompt: 'System',
          history: [],
          userMessage: 'Hello',
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        expect((err as RateLimitError).retryAfterMs).toBe(60_000);
      }
    });
  });

  describe('content filter retry', () => {
    it('retries without tools when content filter is triggered', async () => {
      let callCount = 0;

      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call returns content-filtered response
          return Promise.resolve(createMockSSEResponse([geminiFilteredChunk()]));
        }
        // Retry call (without tools) returns normal response
        return Promise.resolve(
          createMockSSEResponse([
            geminiTextChunk('Safe response'),
            geminiUsageChunk(10, 5, 15),
          ]),
        );
      });

      const orchestrator = createOrchestrator();
      const result = await orchestrator.sendMessage({
        systemPrompt: 'System',
        history: [],
        userMessage: 'Hello',
        tools: mockTools,
      });

      expect(callCount).toBe(2);
      expect(result.text).toContain('Safe response');
    });

    it('throws ContentFilterError when retry also fails', async () => {
      // Must return a fresh Response on each call — a consumed ReadableStream
      // cannot be re-read, so mockResolvedValue with a single Response won't work.
      globalThis.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve(createMockSSEResponse([geminiFilteredChunk()])),
      );

      const onError = vi.fn();
      const orchestrator = createOrchestrator({ onError });

      await expect(
        orchestrator.sendMessage({
          systemPrompt: 'System',
          history: [],
          userMessage: 'Bad content',
          tools: mockTools,
        }),
      ).rejects.toThrow(ContentFilterError);

      // onError should have been called
      expect(onError).toHaveBeenCalled();
    });
  });

  describe('updateConfig()', () => {
    it('swaps adapter when config changes', () => {
      const orchestrator = createOrchestrator();
      const originalAdapter = orchestrator.adapter;

      orchestrator.updateConfig({ provider: 'gemini', apiKey: 'new-key', model: 'gemini-2.5-pro' });

      // Adapter instance should be different
      expect(orchestrator.adapter).not.toBe(originalAdapter);
    });
  });
});
