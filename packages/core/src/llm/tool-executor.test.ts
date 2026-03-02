/**
 * Unit tests for ToolExecutor
 *
 * @module @guidekit/core/llm
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolExecutor } from './tool-executor.js';
import type {
  ToolHandler,
} from './tool-executor.js';
import type { LLMOrchestrator } from './index.js';
import type {
  ToolDefinition,
  ToolCall,
  ConversationTurn,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock LLMOrchestrator. */
function createMockLLM() {
  return {
    sendMessage: vi.fn(),
  } as unknown as LLMOrchestrator & { sendMessage: ReturnType<typeof vi.fn> };
}

/** Create a simple tool definition. */
function createToolDef(name: string, description = ''): ToolDefinition {
  return {
    name,
    description,
    parameters: {},
    schemaVersion: 1,
  };
}

/** Build a response that the mock LLM returns (text only, no tool calls). */
function textResponse(text: string, usage = { prompt: 10, completion: 20, total: 30 }) {
  return {
    text,
    toolCalls: [] as ToolCall[],
    usage,
  };
}

/** Build a response that includes tool calls. */
function toolCallResponse(
  text: string,
  toolCalls: ToolCall[],
  usage = { prompt: 10, completion: 20, total: 30 },
) {
  return {
    text,
    toolCalls,
    usage,
  };
}

/** Build a ToolCall object. */
function makeToolCall(
  id: string,
  name: string,
  args: Record<string, unknown> = {},
): ToolCall {
  return { id, name, arguments: args };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ToolExecutor', () => {
  let executor: ToolExecutor;
  let mockLLM: LLMOrchestrator & { sendMessage: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    executor = new ToolExecutor();
    mockLLM = createMockLLM();
  });

  // -------------------------------------------------------------------------
  // Tool registration
  // -------------------------------------------------------------------------

  describe('tool registration', () => {
    it('registerTool() should register a tool handler', () => {
      const handler: ToolHandler = {
        name: 'get_weather',
        execute: vi.fn(),
      };

      executor.registerTool(handler);
      expect(executor.hasTool('get_weather')).toBe(true);
    });

    it('registerTool() should overwrite an existing handler with the same name', () => {
      const handler1: ToolHandler = {
        name: 'lookup',
        execute: vi.fn().mockResolvedValue('first'),
      };
      const handler2: ToolHandler = {
        name: 'lookup',
        execute: vi.fn().mockResolvedValue('second'),
      };

      executor.registerTool(handler1);
      executor.registerTool(handler2);

      expect(executor.hasTool('lookup')).toBe(true);
      // Only one handler is registered; the second overwrites the first
    });

    it('unregisterTool() should remove a registered tool', () => {
      executor.registerTool({ name: 'temp', execute: vi.fn() });
      expect(executor.hasTool('temp')).toBe(true);

      executor.unregisterTool('temp');
      expect(executor.hasTool('temp')).toBe(false);
    });

    it('unregisterTool() should be a no-op for non-existent tools', () => {
      // Should not throw
      expect(() => executor.unregisterTool('nonexistent')).not.toThrow();
    });

    it('hasTool() should return false for unregistered tools', () => {
      expect(executor.hasTool('unknown')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getToolDefinitions()
  // -------------------------------------------------------------------------

  describe('getToolDefinitions()', () => {
    it('should return an empty array when no tools are registered', () => {
      expect(executor.getToolDefinitions()).toEqual([]);
    });

    it('should return correct shape for registered tools', () => {
      executor.registerTool({ name: 'tool_a', execute: vi.fn() });
      executor.registerTool({ name: 'tool_b', execute: vi.fn() });

      const defs = executor.getToolDefinitions();
      expect(defs).toHaveLength(2);

      for (const def of defs) {
        expect(def).toHaveProperty('name');
        expect(def).toHaveProperty('description', '');
        expect(def).toHaveProperty('parameters', {});
        expect(def).toHaveProperty('schemaVersion', 1);
      }

      const names = defs.map((d) => d.name).sort();
      expect(names).toEqual(['tool_a', 'tool_b']);
    });

    it('should not include unregistered tools', () => {
      executor.registerTool({ name: 'kept', execute: vi.fn() });
      executor.registerTool({ name: 'removed', execute: vi.fn() });
      executor.unregisterTool('removed');

      const defs = executor.getToolDefinitions();
      expect(defs).toHaveLength(1);
      expect(defs[0]!.name).toBe('kept');
    });
  });

  // -------------------------------------------------------------------------
  // executeWithTools() — text-only response (no tool calls)
  // -------------------------------------------------------------------------

  describe('executeWithTools() — text-only response', () => {
    it('should return the text from a single round with no tool calls', async () => {
      mockLLM.sendMessage.mockResolvedValueOnce(
        textResponse('Hello, I can help you!'),
      );

      const result = await executor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'You are helpful.',
        history: [],
        userMessage: 'Hi',
        tools: [createToolDef('greet')],
      });

      expect(result.text).toBe('Hello, I can help you!');
      expect(result.toolCallsExecuted).toEqual([]);
      expect(result.rounds).toBe(1);
      expect(result.totalUsage).toEqual({ prompt: 10, completion: 20, total: 30 });
    });

    it('should pass the correct parameters to the LLM', async () => {
      mockLLM.sendMessage.mockResolvedValueOnce(textResponse('response'));

      const history: ConversationTurn[] = [
        { role: 'user', content: 'previous', timestamp: 1000 },
        { role: 'assistant', content: 'previous response', timestamp: 1001 },
      ];
      const tools = [createToolDef('my_tool', 'A tool')];

      await executor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'system prompt',
        history,
        userMessage: 'user message',
        tools,
      });

      expect(mockLLM.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockLLM.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: 'system prompt',
          userMessage: 'user message',
          tools,
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // executeWithTools() — with tool calls
  // -------------------------------------------------------------------------

  describe('executeWithTools() — with tool calls', () => {
    it('should execute a tool and feed results back to the LLM', async () => {
      // Register a tool
      const weatherHandler: ToolHandler = {
        name: 'get_weather',
        execute: vi.fn().mockResolvedValue({ temp: 72, unit: 'F' }),
      };
      executor.registerTool(weatherHandler);

      // Round 1: LLM asks for a tool call
      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('Let me check the weather.', [
          makeToolCall('call_1', 'get_weather', { city: 'NYC' }),
        ]),
      );

      // Round 2: LLM provides final text response
      mockLLM.sendMessage.mockResolvedValueOnce(
        textResponse('The weather in NYC is 72F.'),
      );

      const result = await executor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'What is the weather in NYC?',
        tools: [createToolDef('get_weather')],
      });

      expect(result.text).toBe('The weather in NYC is 72F.');
      expect(result.rounds).toBe(2);
      expect(result.toolCallsExecuted).toHaveLength(1);
      expect(result.toolCallsExecuted[0]!.name).toBe('get_weather');
      expect(result.toolCallsExecuted[0]!.args).toEqual({ city: 'NYC' });
      expect(result.toolCallsExecuted[0]!.result).toEqual({
        temp: 72,
        unit: 'F',
      });
      expect(result.toolCallsExecuted[0]!.error).toBeUndefined();

      // Verify the tool handler was called with correct args
      expect(weatherHandler.execute).toHaveBeenCalledWith({ city: 'NYC' });

      // Verify the LLM was called twice
      expect(mockLLM.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('should execute multiple tool calls in parallel in a single round', async () => {
      executor.registerTool({
        name: 'get_time',
        execute: vi.fn().mockResolvedValue('10:00 AM'),
      });
      executor.registerTool({
        name: 'get_date',
        execute: vi.fn().mockResolvedValue('2026-03-02'),
      });

      // Round 1: LLM calls two tools at once
      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('', [
          makeToolCall('c1', 'get_time', {}),
          makeToolCall('c2', 'get_date', {}),
        ]),
      );

      // Round 2: text-only
      mockLLM.sendMessage.mockResolvedValueOnce(
        textResponse('It is 10:00 AM on 2026-03-02.'),
      );

      const result = await executor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'What time and date is it?',
        tools: [createToolDef('get_time'), createToolDef('get_date')],
      });

      expect(result.toolCallsExecuted).toHaveLength(2);
      expect(result.rounds).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Multi-round execution
  // -------------------------------------------------------------------------

  describe('multi-round execution', () => {
    it('should handle multiple rounds of tool calls', async () => {
      executor.registerTool({
        name: 'search',
        execute: vi.fn().mockResolvedValue({ results: ['a', 'b'] }),
      });
      executor.registerTool({
        name: 'fetch_detail',
        execute: vi.fn().mockResolvedValue({ detail: 'info about a' }),
      });

      // Round 1: LLM calls search
      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('Searching...', [
          makeToolCall('s1', 'search', { query: 'test' }),
        ]),
      );

      // Round 2: LLM calls fetch_detail based on search results
      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('Fetching details...', [
          makeToolCall('f1', 'fetch_detail', { id: 'a' }),
        ]),
      );

      // Round 3: text-only
      mockLLM.sendMessage.mockResolvedValueOnce(
        textResponse('Here are the details about "a".'),
      );

      const result = await executor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Search and get details',
        tools: [createToolDef('search'), createToolDef('fetch_detail')],
      });

      expect(result.rounds).toBe(3);
      expect(result.toolCallsExecuted).toHaveLength(2);
      expect(result.toolCallsExecuted[0]!.name).toBe('search');
      expect(result.toolCallsExecuted[1]!.name).toBe('fetch_detail');
      expect(result.text).toBe('Here are the details about "a".');

      // Usage should be summed across all 3 rounds
      expect(result.totalUsage.prompt).toBe(30); // 10 * 3
      expect(result.totalUsage.completion).toBe(60); // 20 * 3
      expect(result.totalUsage.total).toBe(90); // 30 * 3
    });
  });

  // -------------------------------------------------------------------------
  // maxRounds limit
  // -------------------------------------------------------------------------

  describe('maxRounds limit', () => {
    it('should stop after maxRounds consecutive tool-calling rounds', async () => {
      const limitedExecutor = new ToolExecutor({ maxRounds: 2 });

      limitedExecutor.registerTool({
        name: 'loop_tool',
        execute: vi.fn().mockResolvedValue('looping'),
      });

      // Both rounds return tool calls — never a text-only response
      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('round 1', [
          makeToolCall('r1', 'loop_tool', {}),
        ]),
      );
      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('round 2', [
          makeToolCall('r2', 'loop_tool', {}),
        ]),
      );

      const result = await limitedExecutor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Loop forever',
        tools: [createToolDef('loop_tool')],
      });

      // Should have stopped after 2 rounds
      expect(result.rounds).toBe(2);
      // The final text is whatever the LLM last produced
      expect(result.text).toBe('round 2');
      expect(result.toolCallsExecuted).toHaveLength(2);
    });

    it('should default maxRounds to 5', async () => {
      const defaultExecutor = new ToolExecutor();

      defaultExecutor.registerTool({
        name: 'infinite',
        execute: vi.fn().mockResolvedValue('still going'),
      });

      // Set up 5 rounds of tool calls + would need 6th but should stop
      for (let i = 0; i < 5; i++) {
        mockLLM.sendMessage.mockResolvedValueOnce(
          toolCallResponse(`round ${i + 1}`, [
            makeToolCall(`c${i}`, 'infinite', {}),
          ]),
        );
      }

      const result = await defaultExecutor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Go on',
        tools: [createToolDef('infinite')],
      });

      expect(result.rounds).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // Abort signal
  // -------------------------------------------------------------------------

  describe('abort signal', () => {
    it('should stop execution when the signal is aborted before the loop', async () => {
      const controller = new AbortController();
      controller.abort(); // Abort immediately

      mockLLM.sendMessage.mockResolvedValueOnce(textResponse('never reached'));

      const result = await executor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Aborted',
        tools: [],
        signal: controller.signal,
      });

      expect(result.rounds).toBe(0);
      expect(result.text).toBe('');
      expect(mockLLM.sendMessage).not.toHaveBeenCalled();
    });

    it('should stop after the current round when signal is aborted mid-execution', async () => {
      const controller = new AbortController();

      executor.registerTool({
        name: 'slow_tool',
        execute: vi.fn().mockImplementation(async () => {
          // Abort during tool execution
          controller.abort();
          return 'done';
        }),
      });

      // Round 1: tool call
      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('calling tool', [
          makeToolCall('a1', 'slow_tool', {}),
        ]),
      );

      // Round 2: should not happen because we aborted
      mockLLM.sendMessage.mockResolvedValueOnce(textResponse('should not reach'));

      const result = await executor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Do something slow',
        tools: [createToolDef('slow_tool')],
        signal: controller.signal,
      });

      // Should complete round 1 but not start round 2
      expect(result.rounds).toBe(1);
      expect(mockLLM.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Unknown tool names
  // -------------------------------------------------------------------------

  describe('unknown tool names', () => {
    it('should return an error record for unknown tool calls', async () => {
      // Do NOT register any tools
      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('', [
          makeToolCall('u1', 'nonexistent_tool', { arg: 'val' }),
        ]),
      );

      mockLLM.sendMessage.mockResolvedValueOnce(
        textResponse('I could not find that tool.'),
      );

      const result = await executor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Use a mystery tool',
        tools: [createToolDef('nonexistent_tool')],
      });

      expect(result.toolCallsExecuted).toHaveLength(1);
      expect(result.toolCallsExecuted[0]!.error).toBe(
        'Unknown tool: nonexistent_tool',
      );
      expect(result.toolCallsExecuted[0]!.result).toBeUndefined();
      expect(result.toolCallsExecuted[0]!.durationMs).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Tool execution errors
  // -------------------------------------------------------------------------

  describe('tool execution errors', () => {
    it('should catch tool errors and return them as error records', async () => {
      executor.registerTool({
        name: 'fail_tool',
        execute: vi.fn().mockRejectedValue(new Error('Tool crashed!')),
      });

      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('', [makeToolCall('e1', 'fail_tool', {})]),
      );

      mockLLM.sendMessage.mockResolvedValueOnce(
        textResponse('There was an error.'),
      );

      const result = await executor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Run failing tool',
        tools: [createToolDef('fail_tool')],
      });

      expect(result.toolCallsExecuted).toHaveLength(1);
      expect(result.toolCallsExecuted[0]!.error).toBe('Tool crashed!');
      expect(result.toolCallsExecuted[0]!.result).toBeUndefined();
    });

    it('should handle non-Error thrown values', async () => {
      executor.registerTool({
        name: 'throw_string',
        execute: vi.fn().mockRejectedValue('string error'),
      });

      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('', [makeToolCall('e2', 'throw_string', {})]),
      );

      mockLLM.sendMessage.mockResolvedValueOnce(textResponse('Handled.'));

      const result = await executor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Run',
        tools: [createToolDef('throw_string')],
      });

      expect(result.toolCallsExecuted[0]!.error).toBe('string error');
    });

    it('should continue the loop even after a tool error', async () => {
      executor.registerTool({
        name: 'flaky_tool',
        execute: vi.fn().mockRejectedValue(new Error('flaky!')),
      });

      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('', [makeToolCall('f1', 'flaky_tool', {})]),
      );

      // After the error result is fed back, LLM responds with text
      mockLLM.sendMessage.mockResolvedValueOnce(
        textResponse('Sorry, the tool failed.'),
      );

      const result = await executor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Try it',
        tools: [createToolDef('flaky_tool')],
      });

      expect(result.rounds).toBe(2);
      expect(result.text).toBe('Sorry, the tool failed.');
    });
  });

  // -------------------------------------------------------------------------
  // Callbacks: onToolCall, onToolResult, onToolError
  // -------------------------------------------------------------------------

  describe('callbacks', () => {
    it('onToolCall should be invoked before tool execution', async () => {
      const onToolCall = vi.fn();
      const cbExecutor = new ToolExecutor({ onToolCall });

      cbExecutor.registerTool({
        name: 'cb_tool',
        execute: vi.fn().mockResolvedValue('ok'),
      });

      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('', [
          makeToolCall('cb1', 'cb_tool', { key: 'value' }),
        ]),
      );
      mockLLM.sendMessage.mockResolvedValueOnce(textResponse('Done'));

      await cbExecutor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Go',
        tools: [createToolDef('cb_tool')],
      });

      expect(onToolCall).toHaveBeenCalledWith('cb_tool', { key: 'value' });
    });

    it('onToolResult should be invoked after successful tool execution', async () => {
      const onToolResult = vi.fn();
      const cbExecutor = new ToolExecutor({ onToolResult });

      cbExecutor.registerTool({
        name: 'result_tool',
        execute: vi.fn().mockResolvedValue({ data: 42 }),
      });

      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('', [makeToolCall('rt1', 'result_tool', {})]),
      );
      mockLLM.sendMessage.mockResolvedValueOnce(textResponse('Got it'));

      await cbExecutor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Go',
        tools: [createToolDef('result_tool')],
      });

      expect(onToolResult).toHaveBeenCalledWith(
        'result_tool',
        { data: 42 },
        expect.any(Number), // durationMs
      );
    });

    it('onToolError should be invoked when a tool throws', async () => {
      const onToolError = vi.fn();
      const cbExecutor = new ToolExecutor({ onToolError });

      cbExecutor.registerTool({
        name: 'error_tool',
        execute: vi.fn().mockRejectedValue(new Error('boom')),
      });

      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('', [makeToolCall('et1', 'error_tool', {})]),
      );
      mockLLM.sendMessage.mockResolvedValueOnce(textResponse('Error handled'));

      await cbExecutor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Go',
        tools: [createToolDef('error_tool')],
      });

      expect(onToolError).toHaveBeenCalledWith(
        'error_tool',
        expect.objectContaining({ message: 'boom' }),
      );
    });

    it('onToolCall is not invoked for unknown tools', async () => {
      const onToolCall = vi.fn();
      const cbExecutor = new ToolExecutor({ onToolCall });

      // No tools registered
      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('', [makeToolCall('x1', 'missing', {})]),
      );
      mockLLM.sendMessage.mockResolvedValueOnce(textResponse('Nope'));

      await cbExecutor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Go',
        tools: [createToolDef('missing')],
      });

      // onToolCall is NOT invoked because the handler is not found
      expect(onToolCall).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // History flattening
  // -------------------------------------------------------------------------

  describe('history flattening', () => {
    it('should pass tool result turns as user turns to the LLM', async () => {
      executor.registerTool({
        name: 'flat_tool',
        execute: vi.fn().mockResolvedValue('tool result data'),
      });

      // Round 1: tool call
      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('', [
          makeToolCall('ft1', 'flat_tool', { x: 1 }),
        ]),
      );

      // Round 2: text response
      mockLLM.sendMessage.mockResolvedValueOnce(textResponse('Final'));

      await executor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Flatten test',
        tools: [createToolDef('flat_tool')],
      });

      // Check the second call's history — it should contain the flattened turns
      const secondCallArgs = mockLLM.sendMessage.mock.calls[1]![0];
      const history = secondCallArgs.history as ConversationTurn[];

      // The history should contain:
      // 1. The assistant turn (with tool call info in content)
      // 2. The tool result turn (as a user turn)
      expect(history.length).toBeGreaterThanOrEqual(2);

      // Find the assistant turn with tool call info
      const assistantTurn = history.find(
        (t) => t.role === 'assistant' && t.content.includes('flat_tool'),
      );
      expect(assistantTurn).toBeDefined();
      expect(assistantTurn!.content).toContain('Calling tool "flat_tool"');
      expect(assistantTurn!.content).toContain('ft1');

      // Find the tool result turn (converted to user role)
      const toolResultTurn = history.find(
        (t) => t.role === 'user' && t.content.includes('Tool result'),
      );
      expect(toolResultTurn).toBeDefined();
      expect(toolResultTurn!.content).toContain('flat_tool');
      expect(toolResultTurn!.content).toContain('ft1');
      expect(toolResultTurn!.content).toContain('tool result data');
    });

    it('should preserve original history turns in the flattened output', async () => {
      const originalHistory: ConversationTurn[] = [
        { role: 'user', content: 'Previous question', timestamp: 100 },
        { role: 'assistant', content: 'Previous answer', timestamp: 200 },
      ];

      mockLLM.sendMessage.mockResolvedValueOnce(textResponse('New answer'));

      await executor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: originalHistory,
        userMessage: 'New question',
        tools: [],
      });

      const callArgs = mockLLM.sendMessage.mock.calls[0]![0];
      const history = callArgs.history as ConversationTurn[];

      expect(history).toHaveLength(2);
      expect(history[0]!.content).toBe('Previous question');
      expect(history[1]!.content).toBe('Previous answer');
    });

    it('assistant tool call turns should include the content and tool call descriptions', async () => {
      executor.registerTool({
        name: 'info_tool',
        execute: vi.fn().mockResolvedValue('info'),
      });

      // Round 1: assistant says something AND calls a tool
      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('Let me look that up for you.', [
          makeToolCall('it1', 'info_tool', { q: 'test' }),
        ]),
      );

      // Round 2: final text
      mockLLM.sendMessage.mockResolvedValueOnce(textResponse('Here is the info.'));

      await executor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Get info',
        tools: [createToolDef('info_tool')],
      });

      const secondCallHistory = mockLLM.sendMessage.mock.calls[1]![0]
        .history as ConversationTurn[];

      const assistantTurn = secondCallHistory.find(
        (t) => t.role === 'assistant' && t.content.includes('info_tool'),
      );
      expect(assistantTurn).toBeDefined();
      // Should contain the original text content
      expect(assistantTurn!.content).toContain('Let me look that up for you.');
      // And the tool call description
      expect(assistantTurn!.content).toContain('Calling tool "info_tool"');
    });

    it('on round 2+, userMessage should be empty string', async () => {
      executor.registerTool({
        name: 'round_tool',
        execute: vi.fn().mockResolvedValue('ok'),
      });

      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('', [makeToolCall('r1', 'round_tool', {})]),
      );
      mockLLM.sendMessage.mockResolvedValueOnce(textResponse('Done'));

      await executor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'First message',
        tools: [createToolDef('round_tool')],
      });

      // First call should have the original user message
      expect(mockLLM.sendMessage.mock.calls[0]![0].userMessage).toBe(
        'First message',
      );
      // Second call should have empty user message
      expect(mockLLM.sendMessage.mock.calls[1]![0].userMessage).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Usage aggregation
  // -------------------------------------------------------------------------

  describe('usage aggregation', () => {
    it('should accumulate token usage across multiple rounds', async () => {
      executor.registerTool({
        name: 'usage_tool',
        execute: vi.fn().mockResolvedValue('x'),
      });

      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('', [makeToolCall('u1', 'usage_tool', {})], {
          prompt: 5,
          completion: 10,
          total: 15,
        }),
      );
      mockLLM.sendMessage.mockResolvedValueOnce(
        textResponse('Done', {
          prompt: 8,
          completion: 12,
          total: 20,
        }),
      );

      const result = await executor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Go',
        tools: [createToolDef('usage_tool')],
      });

      expect(result.totalUsage).toEqual({
        prompt: 13,
        completion: 22,
        total: 35,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Debug logging
  // -------------------------------------------------------------------------

  describe('debug logging', () => {
    it('should log when debug is enabled', async () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const debugExecutor = new ToolExecutor({ debug: true });

      mockLLM.sendMessage.mockResolvedValueOnce(textResponse('Hello'));

      await debugExecutor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Test',
        tools: [],
      });

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0]![0]).toContain('[GuideKit:ToolExecutor]');

      consoleSpy.mockRestore();
    });

    it('should not log when debug is disabled', async () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const quietExecutor = new ToolExecutor({ debug: false });

      mockLLM.sendMessage.mockResolvedValueOnce(textResponse('Hello'));

      await quietExecutor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Test',
        tools: [],
      });

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle LLM returning text alongside tool calls', async () => {
      executor.registerTool({
        name: 'edge_tool',
        execute: vi.fn().mockResolvedValue('result'),
      });

      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('Thinking out loud...', [
          makeToolCall('eg1', 'edge_tool', {}),
        ]),
      );

      mockLLM.sendMessage.mockResolvedValueOnce(
        textResponse('Final answer after tool.'),
      );

      const result = await executor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Edge',
        tools: [createToolDef('edge_tool')],
      });

      // The final text should be from the last LLM response
      expect(result.text).toBe('Final answer after tool.');
    });

    it('should handle empty text in final response', async () => {
      mockLLM.sendMessage.mockResolvedValueOnce(
        textResponse(''),
      );

      const result = await executor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Say nothing',
        tools: [],
      });

      expect(result.text).toBe('');
    });

    it('should handle tool returning undefined', async () => {
      executor.registerTool({
        name: 'void_tool',
        execute: vi.fn().mockResolvedValue(undefined),
      });

      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('', [makeToolCall('v1', 'void_tool', {})]),
      );
      mockLLM.sendMessage.mockResolvedValueOnce(textResponse('Done'));

      const result = await executor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Void',
        tools: [createToolDef('void_tool')],
      });

      expect(result.toolCallsExecuted[0]!.result).toBeUndefined();
      expect(result.toolCallsExecuted[0]!.error).toBeUndefined();
    });

    it('should handle tool returning null', async () => {
      executor.registerTool({
        name: 'null_tool',
        execute: vi.fn().mockResolvedValue(null),
      });

      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('', [makeToolCall('n1', 'null_tool', {})]),
      );
      mockLLM.sendMessage.mockResolvedValueOnce(textResponse('Done'));

      const result = await executor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Null',
        tools: [createToolDef('null_tool')],
      });

      expect(result.toolCallsExecuted[0]!.result).toBeNull();
      expect(result.toolCallsExecuted[0]!.error).toBeUndefined();
    });

    it('should work with maxRounds set to 1', async () => {
      const singleRoundExecutor = new ToolExecutor({ maxRounds: 1 });

      singleRoundExecutor.registerTool({
        name: 'once',
        execute: vi.fn().mockResolvedValue('once'),
      });

      // The single round returns tool calls — should stop after this round
      mockLLM.sendMessage.mockResolvedValueOnce(
        toolCallResponse('Only text from round 1', [
          makeToolCall('o1', 'once', {}),
        ]),
      );

      const result = await singleRoundExecutor.executeWithTools({
        llm: mockLLM,
        systemPrompt: 'System',
        history: [],
        userMessage: 'Once',
        tools: [createToolDef('once')],
      });

      expect(result.rounds).toBe(1);
      expect(result.text).toBe('Only text from round 1');
      expect(result.toolCallsExecuted).toHaveLength(1);
    });
  });
});
