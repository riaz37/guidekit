// ---------------------------------------------------------------------------
// GuideKitCore — sendText() unit tests
// ---------------------------------------------------------------------------
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMockEventBus,
  createMockResourceManager,
  createMockDOMScanner,
  createMockContextManager,
  createMockLLMOrchestrator,
  createMockToolExecutor,
  createMockConnectionManager,
  createMockNavigationController,
  createMockVisualGuidance,
  createMockAwarenessSystem,
  createMockProactiveEngine,
  createMockRateLimiter,
  createMockI18n,
  createMockTokenManager,
} from './__test-utils__/index.js';

// ---------------------------------------------------------------------------
// Mock all subsystem imports — must be declared before importing the class
// under test so Vitest hoists them.
// ---------------------------------------------------------------------------

const mockEventBus = createMockEventBus();

vi.mock('./bus/index.js', () => ({
  EventBus: vi.fn(),
  createEventBus: vi.fn(() => mockEventBus),
}));

const mockResourceManager = createMockResourceManager();

vi.mock('./resources/index.js', () => ({
  ResourceManager: vi.fn(() => mockResourceManager),
  SingletonGuard: {
    acquire: vi.fn((_id: string, factory: () => unknown) => factory()),
    release: vi.fn(),
  },
}));

const mockDOMScanner = createMockDOMScanner();

vi.mock('./dom/index.js', () => ({
  DOMScanner: vi.fn(() => mockDOMScanner),
}));

const mockContextManager = createMockContextManager();

vi.mock('./context/index.js', () => ({
  ContextManager: vi.fn(() => mockContextManager),
}));

const mockLLMOrchestrator = createMockLLMOrchestrator();

vi.mock('./llm/index.js', () => ({
  LLMOrchestrator: vi.fn(() => mockLLMOrchestrator),
  GeminiAdapter: vi.fn(),
}));

const mockToolExecutor: Record<string, ReturnType<typeof vi.fn>> = createMockToolExecutor();

vi.mock('./llm/tool-executor.js', () => ({
  ToolExecutor: vi.fn(() => mockToolExecutor),
}));

const mockConnectionManager = createMockConnectionManager();

vi.mock('./connectivity/index.js', () => ({
  ConnectionManager: vi.fn(() => mockConnectionManager),
}));

const mockNavigationController = createMockNavigationController();

vi.mock('./navigation/index.js', () => ({
  NavigationController: vi.fn(() => mockNavigationController),
}));

vi.mock('./voice/index.js', () => ({
  VoicePipeline: vi.fn(),
}));

const mockVisualGuidance = createMockVisualGuidance();

vi.mock('./visual/index.js', () => ({
  VisualGuidance: vi.fn(() => mockVisualGuidance),
}));

const mockAwarenessSystem = createMockAwarenessSystem();

vi.mock('./awareness/index.js', () => ({
  AwarenessSystem: vi.fn(() => mockAwarenessSystem),
}));

const mockProactiveEngine = createMockProactiveEngine();

vi.mock('./awareness/proactive.js', () => ({
  ProactiveTriggerEngine: vi.fn(() => mockProactiveEngine),
}));

const mockRateLimiter = createMockRateLimiter();

vi.mock('./llm/rate-limiter.js', () => ({
  RateLimiter: vi.fn(() => mockRateLimiter),
}));

const mockI18n = createMockI18n();

vi.mock('./i18n/index.js', () => ({
  I18n: vi.fn(() => mockI18n),
}));

const mockTokenManager = createMockTokenManager();

vi.mock('./auth/token-manager.js', () => ({
  TokenManager: vi.fn(() => mockTokenManager),
}));

// ---------------------------------------------------------------------------
// Import class under test (after mocks are hoisted)
// ---------------------------------------------------------------------------

import { GuideKitCore } from './core.js';
import type { BeforeLLMCallContext } from './core.js';
import { GuideKitError, ConfigurationError, ErrorCodes } from './errors/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an initialized GuideKitCore with sensible defaults. */
async function createInitializedCore(
  overrides?: Partial<ConstructorParameters<typeof GuideKitCore>[0]>,
): Promise<GuideKitCore> {
  const core = new GuideKitCore({
    llm: { provider: 'gemini', apiKey: 'test-key' },
    ...overrides,
  });
  await core.init();
  return core;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GuideKitCore.sendText()', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-establish default mock return values that vi.clearAllMocks resets
    mockToolExecutor.executeWithTools.mockResolvedValue({
      text: 'tool response',
      toolCallsExecuted: [],
      totalUsage: { prompt: 10, completion: 20, total: 30 },
      rounds: 1,
    });
    // sendText delegates to sendTextStream which uses executeWithToolsStream
    mockToolExecutor.executeWithToolsStream = vi.fn(async function* () {
      yield 'tool response';
      return {
        text: 'tool response',
        toolCallsExecuted: [],
        totalUsage: { prompt: 10, completion: 20, total: 30 },
        rounds: 1,
      };
    });
    mockContextManager.getHistory.mockReturnValue([]);
    mockContextManager.buildSystemPrompt.mockReturnValue('System prompt');
    mockContextManager.restoreSession.mockReturnValue(null);
    mockDOMScanner.observe.mockReturnValue(vi.fn());
    // Reset rate limiter (may have been set to throw by previous tests)
    mockRateLimiter.checkLLMCall.mockReset();
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Happy path
  // -----------------------------------------------------------------------

  describe('happy path', () => {
    it('returns the LLM response text', async () => {
      const core = await createInitializedCore();

      const result = await core.sendText('Hello');

      expect(result).toBe('tool response');
      await core.destroy();
    });

    it('records user and assistant turns via addTurn', async () => {
      const core = await createInitializedCore();

      await core.sendText('Hello');

      // First call: user turn
      expect(mockContextManager.addTurn).toHaveBeenCalledTimes(2);
      expect(mockContextManager.addTurn).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ role: 'user', content: 'Hello' }),
      );
      // Second call: assistant turn
      expect(mockContextManager.addTurn).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ role: 'assistant', content: 'tool response' }),
      );

      await core.destroy();
    });

    it('calls saveSession after a successful response', async () => {
      const core = await createInitializedCore();

      await core.sendText('Hello');

      expect(mockContextManager.saveSession).toHaveBeenCalledTimes(1);
      await core.destroy();
    });

    it('passes systemPrompt, history, and userMessage to ToolExecutor', async () => {
      const core = await createInitializedCore();

      await core.sendText('Tell me about this page');

      expect(mockToolExecutor.executeWithToolsStream).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: 'System prompt',
          userMessage: 'Tell me about this page',
        }),
      );

      await core.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Concurrent send rejection
  // -----------------------------------------------------------------------

  describe('concurrent send rejection', () => {
    it('rejects a second sendText while the first is in flight', async () => {
      // Make the first sendText hang so it stays in flight
      mockToolExecutor.executeWithToolsStream = vi.fn(async function* () {
        await new Promise((resolve) => setTimeout(resolve, 100));
        yield 'delayed';
        return {
          text: 'delayed',
          toolCallsExecuted: [],
          totalUsage: { prompt: 10, completion: 20, total: 30 },
          rounds: 1,
        };
      });

      const core = await createInitializedCore();

      const firstCall = core.sendText('First message');

      // Immediately call sendText again before the first resolves
      await expect(core.sendText('Second message')).rejects.toThrow(
        'A message is already being processed',
      );

      // Verify error code
      try {
        await core.sendText('Third message');
      } catch (err) {
        expect(err).toBeInstanceOf(GuideKitError);
        expect((err as GuideKitError).code).toBe('SEND_IN_FLIGHT');
      }

      // Wait for the first call to complete so the test cleans up
      await firstCall;
      await core.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // 3. Message too long
  // -----------------------------------------------------------------------

  describe('message too long', () => {
    it('throws INPUT_TOO_LONG when message exceeds maxMessageLength', async () => {
      const core = await createInitializedCore({
        options: { maxMessageLength: 20 },
      });

      const longMessage = 'A'.repeat(21);

      try {
        await core.sendText(longMessage);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(GuideKitError);
        expect((err as GuideKitError).code).toBe('INPUT_TOO_LONG');
        expect((err as GuideKitError).message).toContain('20');
      }

      await core.destroy();
    });

    it('uses the default maxMessageLength of 10000 when not configured', async () => {
      const core = await createInitializedCore();

      // A message at exactly 10000 chars should succeed
      const exactMessage = 'B'.repeat(10_000);
      const result = await core.sendText(exactMessage);
      expect(result).toBe('tool response');

      await core.destroy();
    });

    it('rejects a message of 10001 chars with default limit', async () => {
      const core = await createInitializedCore();

      const tooLong = 'C'.repeat(10_001);
      try {
        await core.sendText(tooLong);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(GuideKitError);
        expect((err as GuideKitError).code).toBe('INPUT_TOO_LONG');
      }

      await core.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // 4. Rate limit enforcement
  // -----------------------------------------------------------------------

  describe('rate limit enforcement', () => {
    it('throws when rateLimiter.checkLLMCall rejects', async () => {
      const rateLimitError = new GuideKitError({
        code: ErrorCodes.RATE_LIMIT_CLIENT,
        message: 'LLM rate limit exceeded',
        recoverable: true,
        suggestion: 'Wait before sending another message.',
      });
      mockRateLimiter.checkLLMCall.mockImplementation(() => {
        throw rateLimitError;
      });

      const core = await createInitializedCore();

      try {
        await core.sendText('Hello');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBe(rateLimitError);
        expect((err as GuideKitError).code).toBe(ErrorCodes.RATE_LIMIT_CLIENT);
      }

      await core.destroy();
    });

    it('does not call ToolExecutor when rate limit is hit', async () => {
      mockRateLimiter.checkLLMCall.mockImplementation(() => {
        throw new GuideKitError({
          code: ErrorCodes.RATE_LIMIT_CLIENT,
          message: 'Rate limit',
          recoverable: true,
          suggestion: 'Wait.',
        });
      });

      const core = await createInitializedCore();

      try {
        await core.sendText('Hello');
      } catch {
        // expected
      }

      expect(mockToolExecutor.executeWithToolsStream).not.toHaveBeenCalled();
      await core.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // 5. onBeforeLLMCall privacy hook
  // -----------------------------------------------------------------------

  describe('onBeforeLLMCall privacy hook', () => {
    it('passes modified message to LLM when hook rewrites userMessage', async () => {
      const hookFn = vi.fn((ctx: BeforeLLMCallContext) => ({
        ...ctx,
        userMessage: 'REDACTED',
      }));

      const core = await createInitializedCore({
        onBeforeLLMCall: hookFn,
      });

      await core.sendText('my SSN is 123-45-6789');

      expect(mockToolExecutor.executeWithToolsStream).toHaveBeenCalledWith(
        expect.objectContaining({
          userMessage: 'REDACTED',
        }),
      );

      await core.destroy();
    });

    it('passes modified systemPrompt to LLM when hook rewrites it', async () => {
      const hookFn = vi.fn((ctx: BeforeLLMCallContext) => ({
        ...ctx,
        systemPrompt: 'MODIFIED SYSTEM PROMPT',
      }));

      const core = await createInitializedCore({
        onBeforeLLMCall: hookFn,
      });

      await core.sendText('test');

      expect(mockToolExecutor.executeWithToolsStream).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: 'MODIFIED SYSTEM PROMPT',
        }),
      );

      await core.destroy();
    });

    it('cancels request and throws PRIVACY_HOOK_CANCELLED when hook throws', async () => {
      const hookFn = vi.fn(() => {
        throw new Error('PII detected');
      });

      const core = await createInitializedCore({
        onBeforeLLMCall: hookFn,
      });

      try {
        await core.sendText('secret data');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(GuideKitError);
        expect((err as GuideKitError).code).toBe(ErrorCodes.PRIVACY_HOOK_CANCELLED);
        expect((err as GuideKitError).message).toBe('PII detected');
      }

      // Verify ToolExecutor was never called
      expect(mockToolExecutor.executeWithToolsStream).not.toHaveBeenCalled();

      await core.destroy();
    });

    it('passes through a GuideKitError thrown by hook unchanged', async () => {
      const customErr = new GuideKitError({
        code: 'CUSTOM_PII',
        message: 'Custom PII error',
        recoverable: true,
        suggestion: 'Remove PII',
      });
      const hookFn = vi.fn(() => {
        throw customErr;
      });

      const core = await createInitializedCore({
        onBeforeLLMCall: hookFn,
      });

      try {
        await core.sendText('test');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBe(customErr);
        expect((err as GuideKitError).code).toBe('CUSTOM_PII');
      }

      await core.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // 6. Not initialized — sendText before init
  // -----------------------------------------------------------------------

  describe('not initialized', () => {
    it('throws ConfigurationError when called before init()', async () => {
      const core = new GuideKitCore({
        llm: { provider: 'gemini', apiKey: 'test-key' },
      });

      try {
        await core.sendText('Hello');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigurationError);
        expect((err as GuideKitError).code).toBe(ErrorCodes.CONFIG_MISSING_REQUIRED);
        expect((err as GuideKitError).message).toContain('not initialized');
      }
    });
  });

  // -----------------------------------------------------------------------
  // 7. State transitions
  // -----------------------------------------------------------------------

  describe('state transitions', () => {
    it('transitions to processing during sendText, then idle on success', async () => {
      const states: string[] = [];

      mockToolExecutor.executeWithToolsStream = vi.fn(async function* () {
        // Capture the agent state while processing
        states.push(core.agentState.status);
        yield 'response';
        return {
          text: 'response',
          toolCallsExecuted: [],
          totalUsage: { prompt: 10, completion: 20, total: 30 },
          rounds: 1,
        };
      });

      const core = await createInitializedCore();

      // State should be idle before
      expect(core.agentState.status).toBe('idle');

      await core.sendText('Hello');

      // During execution the state was 'processing'
      expect(states).toContain('processing');

      // After successful completion, state should be idle
      expect(core.agentState.status).toBe('idle');

      await core.destroy();
    });

    it('transitions to error state when ToolExecutor throws', async () => {
      // eslint-disable-next-line require-yield
      mockToolExecutor.executeWithToolsStream = vi.fn(async function* () {
        throw new Error('LLM failure');
      });

      const core = await createInitializedCore();

      try {
        await core.sendText('Hello');
      } catch {
        // expected
      }

      expect(core.agentState.status).toBe('error');

      await core.destroy();
    });

    it('transitions to idle when onBeforeLLMCall hook cancels', async () => {
      const hookFn = vi.fn(() => {
        throw new Error('Blocked');
      });

      const core = await createInitializedCore({
        onBeforeLLMCall: hookFn,
      });

      try {
        await core.sendText('secret');
      } catch {
        // expected
      }

      expect(core.agentState.status).toBe('idle');

      await core.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // 8. Event emissions
  // -----------------------------------------------------------------------

  describe('event emissions', () => {
    it('emits llm:response-start and llm:response-end on success', async () => {
      const core = await createInitializedCore();

      await core.sendText('Hello');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'llm:response-start',
        expect.objectContaining({ conversationId: expect.any(String) }),
      );
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'llm:response-end',
        expect.objectContaining({
          conversationId: expect.any(String),
          totalTokens: 30,
        }),
      );

      await core.destroy();
    });

    it('emits error event when ToolExecutor fails', async () => {
      // eslint-disable-next-line require-yield
      mockToolExecutor.executeWithToolsStream = vi.fn(async function* () {
        throw new Error('Boom');
      });

      const core = await createInitializedCore();

      try {
        await core.sendText('Hello');
      } catch {
        // expected
      }

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'error',
        expect.any(GuideKitError),
      );

      await core.destroy();
    });
  });
});

// ---------------------------------------------------------------------------
// GuideKitCore.sendTextStream() streaming tests
// ---------------------------------------------------------------------------

describe('GuideKitCore.sendTextStream()', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-establish default mock return values that vi.clearAllMocks resets
    mockToolExecutor.executeWithTools.mockResolvedValue({
      text: 'tool response',
      toolCallsExecuted: [],
      totalUsage: { prompt: 10, completion: 20, total: 30 },
      rounds: 1,
    });
    mockToolExecutor.executeWithToolsStream = vi.fn(async function* () {
      yield 'tool response';
      return {
        text: 'tool response',
        toolCallsExecuted: [],
        totalUsage: { prompt: 10, completion: 20, total: 30 },
        rounds: 1,
      };
    });
    mockContextManager.getHistory.mockReturnValue([]);
    mockContextManager.buildSystemPrompt.mockReturnValue('System prompt');
    mockContextManager.restoreSession.mockReturnValue(null);
    mockDOMScanner.observe.mockReturnValue(vi.fn());
    // Reset rate limiter (may have been set to throw by earlier tests)
    mockRateLimiter.checkLLMCall.mockReset();
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Return shape
  // -----------------------------------------------------------------------

  describe('return shape', () => {
    it('returns { stream, done }', async () => {
      // Set up the streaming mock on executeWithToolsStream
      mockToolExecutor.executeWithToolsStream = vi.fn(function* () {
        yield 'chunk1';
        return {
          text: 'chunk1',
          toolCallsExecuted: [],
          totalUsage: { prompt: 10, completion: 20, total: 30 },
          rounds: 1,
        };
      });

      const core = await createInitializedCore();

      const result = core.sendTextStream('Hello');

      expect(result).toHaveProperty('stream');
      expect(result).toHaveProperty('done');
      expect(typeof result.done.then).toBe('function'); // done is a Promise

      // Consume the stream to clean up
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of result.stream) { /* consume */ }
      await result.done;

      await core.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Consuming stream yields chunks and done resolves
  // -----------------------------------------------------------------------

  describe('stream consumption', () => {
    it('consuming stream yields chunks and done resolves', async () => {
      // Mock executeWithToolsStream as an async generator that yields string chunks
      mockToolExecutor.executeWithToolsStream = vi.fn(async function* () {
        yield 'Hello ';
        yield 'world';
        yield '!';
        return {
          text: 'Hello world!',
          toolCallsExecuted: [],
          totalUsage: { prompt: 10, completion: 20, total: 30 },
          rounds: 1,
        };
      });

      const core = await createInitializedCore();

      const { stream, done } = core.sendTextStream('Hello');
      // Prevent unhandled rejection
      done.catch(() => {});

      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello ', 'world', '!']);

      const streamResult = await done;
      expect(streamResult).toEqual({
        fullText: 'Hello world!',
        totalTokens: 30,
        toolCallsExecuted: 0,
        rounds: 1,
      });

      await core.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // 3. sendText() backward compatibility
  // -----------------------------------------------------------------------

  describe('sendText backward compatibility', () => {
    it('sendText() still works as backward compat', async () => {
      // sendText delegates to sendTextStream internally, so mock the stream path
      mockToolExecutor.executeWithToolsStream = vi.fn(async function* () {
        yield 'streamed response';
        return {
          text: 'streamed response',
          toolCallsExecuted: [],
          totalUsage: { prompt: 10, completion: 20, total: 30 },
          rounds: 1,
        };
      });

      const core = await createInitializedCore();

      const result = await core.sendText('Hello');

      // sendText should return a plain string
      expect(typeof result).toBe('string');
      expect(result).toBe('streamed response');

      await core.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // 4. Concurrent stream rejected
  // -----------------------------------------------------------------------

  describe('concurrent stream rejected', () => {
    it('rejects a second sendTextStream while the first is in flight', async () => {
      // Make the stream hang by yielding after a delay
      mockToolExecutor.executeWithToolsStream = vi.fn(async function* () {
        await new Promise((resolve) => setTimeout(resolve, 100));
        yield 'delayed';
        return {
          text: 'delayed',
          toolCallsExecuted: [],
          totalUsage: { prompt: 10, completion: 20, total: 30 },
          rounds: 1,
        };
      });

      const core = await createInitializedCore();

      // Start the first stream (but don't consume it fully yet — just
      // invoking sendTextStream sets _sendInFlight synchronously)
      const first = core.sendTextStream('First message');
      first.done.catch(() => {}); // prevent unhandled rejection

      // Immediately try a second stream → should throw SEND_IN_FLIGHT
      expect(() => core.sendTextStream('Second message')).toThrow(
        'A message is already being processed',
      );

      try {
        core.sendTextStream('Third message');
      } catch (err) {
        expect(err).toBeInstanceOf(GuideKitError);
        expect((err as GuideKitError).code).toBe('SEND_IN_FLIGHT');
      }

      // Consume the first stream so the test cleans up
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of first.stream) { /* consume */ }
      await first.done;

      await core.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // 5. Streaming state updates in store snapshot
  // -----------------------------------------------------------------------

  describe('streaming state in store snapshot', () => {
    it('streaming state updates in store snapshot during streaming', async () => {
      let resolveYield!: () => void;
      const yieldGate = new Promise<void>((resolve) => {
        resolveYield = resolve;
      });

      mockToolExecutor.executeWithToolsStream = vi.fn(async function* () {
        yield 'chunk1';
        // Pause here so we can inspect the snapshot mid-stream
        await yieldGate;
        yield 'chunk2';
        return {
          text: 'chunk1chunk2',
          toolCallsExecuted: [],
          totalUsage: { prompt: 10, completion: 20, total: 30 },
          rounds: 1,
        };
      });

      const core = await createInitializedCore();

      // Before streaming, isStreaming should be false
      expect(core.getSnapshot().streaming.isStreaming).toBe(false);

      const { stream, done } = core.sendTextStream('Hello');
      done.catch(() => {});

      // Read the first chunk to start streaming
      const iterator = stream[Symbol.asyncIterator]();
      const firstChunk = await iterator.next();
      expect(firstChunk.value).toBe('chunk1');

      // During streaming, isStreaming should be true
      expect(core.getSnapshot().streaming.isStreaming).toBe(true);
      expect(core.getSnapshot().streaming.streamingText).toBe('chunk1');

      // Release the gate so the generator can finish
      resolveYield();

      // Consume the rest
      let next = await iterator.next();
      while (!next.done) {
        next = await iterator.next();
      }

      await done;

      // After streaming completes, isStreaming should be false
      expect(core.getSnapshot().streaming.isStreaming).toBe(false);
      expect(core.getSnapshot().streaming.streamingText).toBe('');

      await core.destroy();
    });
  });
});
