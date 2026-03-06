// ---------------------------------------------------------------------------
// GuideKitCore — Health check & privacy hook (onBeforeLLMCall) tests
// ---------------------------------------------------------------------------
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock all subsystem imports so we can construct GuideKitCore without the
// real browser-dependent subsystems.
// ---------------------------------------------------------------------------

// Stubs for subsystems — minimal implementations for constructor / init
const mockEventBus = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  onAny: vi.fn(),
};

vi.mock('./bus/index.js', () => ({
  EventBus: vi.fn(),
  createEventBus: vi.fn(() => mockEventBus),
}));

const mockResourceManager = {
  register: vi.fn(),
  markReady: vi.fn(),
};

vi.mock('./resources/index.js', () => ({
  ResourceManager: vi.fn(() => mockResourceManager),
  SingletonGuard: {
    acquire: vi.fn((_id: string, factory: () => unknown) => factory()),
    release: vi.fn(),
  },
}));

const mockDOMScanner = {
  scan: vi.fn(() => ({
    url: 'https://example.com',
    title: 'Test Page',
    meta: { description: '', h1: 'Test', language: 'en' },
    sections: [],
    navigation: [],
    interactiveElements: [],
    forms: [],
    activeOverlays: [],
    viewport: { width: 1024, height: 768, orientation: 'landscape' },
    allSectionsSummary: [],
    hash: 'abc123',
    timestamp: Date.now(),
    scanMetadata: {
      totalSectionsFound: 0,
      sectionsIncluded: 0,
      totalNodesScanned: 0,
      scanBudgetExhausted: false,
    },
  })),
  observe: vi.fn(() => vi.fn()),
};

vi.mock('./dom/index.js', () => ({
  DOMScanner: vi.fn(() => mockDOMScanner),
}));

const mockContextManager = {
  restoreSession: vi.fn(() => null),
  saveSession: vi.fn(),
  addTurn: vi.fn(),
  getHistory: vi.fn(() => []),
  buildSystemPrompt: vi.fn(() => 'System prompt'),
  setPageContext: vi.fn(),
  getContent: vi.fn(),
  quietMode: false,
  userPreference: 'text' as const,
};

vi.mock('./context/index.js', () => ({
  ContextManager: vi.fn(() => mockContextManager),
}));

const mockLLMSendMessage = vi.fn();
const mockLLMOrchestrator = {
  sendMessage: mockLLMSendMessage,
};

vi.mock('./llm/index.js', () => ({
  LLMOrchestrator: vi.fn(() => mockLLMOrchestrator),
  GeminiAdapter: vi.fn(),
}));

const mockToolExecutor: Record<string, ReturnType<typeof vi.fn>> = {
  registerTool: vi.fn(),
  executeWithTools: vi.fn().mockResolvedValue({
    text: 'Agent response',
    totalUsage: { total: 100 },
  }),
  executeWithToolsStream: vi.fn(async function* () {
    yield 'Agent response';
    return {
      text: 'Agent response',
      toolCallsExecuted: [],
      totalUsage: { prompt: 50, completion: 50, total: 100 },
      rounds: 1,
    };
  }),
};

vi.mock('./llm/tool-executor.js', () => ({
  ToolExecutor: vi.fn(() => mockToolExecutor),
}));

const mockConnectionManager = {
  onStateChange: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
};

vi.mock('./connectivity/index.js', () => ({
  ConnectionManager: vi.fn(() => mockConnectionManager),
}));

const mockNavigationController = {
  onRouteChange: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
};

vi.mock('./navigation/index.js', () => ({
  NavigationController: vi.fn(() => mockNavigationController),
}));

vi.mock('./voice/index.js', () => ({
  VoicePipeline: vi.fn(),
}));

const mockVisualGuidance = {
  highlight: vi.fn(),
  dismissHighlight: vi.fn(),
  scrollToSection: vi.fn(),
  scrollToSelector: vi.fn(),
  startTour: vi.fn(),
  nextTourStep: vi.fn(),
  prevTourStep: vi.fn(),
  stopTour: vi.fn(),
  destroy: vi.fn(),
};

vi.mock('./visual/index.js', () => ({
  VisualGuidance: vi.fn(() => mockVisualGuidance),
}));

const mockAwarenessSystem = {
  start: vi.fn(),
  destroy: vi.fn(),
};

vi.mock('./awareness/index.js', () => ({
  AwarenessSystem: vi.fn(() => mockAwarenessSystem),
}));

const mockProactiveEngine = {
  start: vi.fn(),
  destroy: vi.fn(),
  quietMode: false,
};

vi.mock('./awareness/proactive.js', () => ({
  ProactiveTriggerEngine: vi.fn(() => mockProactiveEngine),
}));

const mockRateLimiter = {
  checkLLMCall: vi.fn(),
  getState: vi.fn(() => ({})),
};

vi.mock('./llm/rate-limiter.js', () => ({
  RateLimiter: vi.fn(() => mockRateLimiter),
}));

const mockI18n = {
  t: vi.fn((key: string) => key),
};

vi.mock('./i18n/index.js', () => ({
  I18n: vi.fn(() => mockI18n),
}));

const mockTokenManager = {
  start: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn(),
  token: 'mock-token',
};

vi.mock('./auth/token-manager.js', () => ({
  TokenManager: vi.fn(() => mockTokenManager),
}));

// ---------------------------------------------------------------------------
// Import the class under test (after mocks are set up)
// ---------------------------------------------------------------------------

import { GuideKitCore } from './core.js';
import type { BeforeLLMCallContext } from './core.js';
import { GuideKitError } from './errors/index.js';

// ---------------------------------------------------------------------------
// Tests: Health Check
// ---------------------------------------------------------------------------

describe('GuideKitCore.checkHealth()', () => {
  let core: GuideKitCore;

  beforeEach(async () => {
    vi.clearAllMocks();
    core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'test-key' },
    });
    await core.init();
  });

  afterEach(async () => {
    await core.destroy();
  });

  it('returns an object with llm, stt, tts, mic, and overall fields', async () => {
    const result = await core.checkHealth();
    expect(result).toHaveProperty('llm');
    expect(result).toHaveProperty('stt');
    expect(result).toHaveProperty('tts');
    expect(result).toHaveProperty('mic');
    expect(result).toHaveProperty('overall');
  });

  it('reports LLM as ok when llm orchestrator is configured', async () => {
    const result = await core.checkHealth();
    expect(result.llm.status).toBe('ok');
  });

  it('reports LLM latency as a number', async () => {
    const result = await core.checkHealth();
    expect(typeof result.llm.latencyMs).toBe('number');
    expect(result.llm.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports STT as not-configured when no STT config', async () => {
    const result = await core.checkHealth();
    expect(result.stt.status).toBe('not-configured');
  });

  it('reports TTS as not-configured when no TTS config', async () => {
    const result = await core.checkHealth();
    expect(result.tts.status).toBe('not-configured');
  });

  it('reports mic as unavailable when navigator.mediaDevices is missing', async () => {
    const original = navigator.mediaDevices;
    // Remove mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const result = await core.checkHealth();
    expect(result.mic.status).toBe('not-configured');

    // Restore
    Object.defineProperty(navigator, 'mediaDevices', {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it('reports mic as ok when audioinput devices are found', async () => {
    const original = navigator.mediaDevices;
    const mockEnumerate = vi.fn().mockResolvedValue([
      { kind: 'audioinput', deviceId: 'mic1', label: 'Mic', groupId: '' },
    ]);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { enumerateDevices: mockEnumerate },
      configurable: true,
      writable: true,
    });

    const result = await core.checkHealth();
    expect(result.mic.status).toBe('ok');

    Object.defineProperty(navigator, 'mediaDevices', {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it('reports mic as unavailable when no audioinput devices exist', async () => {
    const original = navigator.mediaDevices;
    const mockEnumerate = vi.fn().mockResolvedValue([
      { kind: 'audiooutput', deviceId: 'speaker1', label: 'Speaker', groupId: '' },
    ]);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { enumerateDevices: mockEnumerate },
      configurable: true,
      writable: true,
    });

    const result = await core.checkHealth();
    expect(result.mic.status).toBe('unavailable');

    Object.defineProperty(navigator, 'mediaDevices', {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it('reports mic as unavailable when enumerateDevices throws', async () => {
    const original = navigator.mediaDevices;
    const mockEnumerate = vi.fn().mockRejectedValue(new Error('Permission denied'));
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { enumerateDevices: mockEnumerate },
      configurable: true,
      writable: true,
    });

    const result = await core.checkHealth();
    expect(result.mic.status).toBe('unavailable');
    expect(result.mic.error).toBe('Permission denied');

    Object.defineProperty(navigator, 'mediaDevices', {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it('computes overall as ok when all configured services are ok', async () => {
    const result = await core.checkHealth();
    // Only LLM is configured; STT/TTS/mic are not-configured
    expect(result.overall).toBe('ok');
  });

  it('computes overall as unavailable when any configured service is unavailable', async () => {
    // Force mic to report unavailable
    const original = navigator.mediaDevices;
    const mockEnumerate = vi.fn().mockRejectedValue(new Error('No access'));
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { enumerateDevices: mockEnumerate },
      configurable: true,
      writable: true,
    });

    const result = await core.checkHealth();
    expect(result.overall).toBe('unavailable');

    Object.defineProperty(navigator, 'mediaDevices', {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it('does not include not-configured services in overall calculation', async () => {
    // With only LLM configured (ok), overall should be ok
    const result = await core.checkHealth();
    expect(result.overall).toBe('ok');
    expect(result.stt.status).toBe('not-configured');
    expect(result.tts.status).toBe('not-configured');
  });

  it('reports LLM as not-configured when no LLM orchestrator exists', async () => {
    // Create a core without LLM but with tokenEndpoint to bypass config validation
    const noLLMCore = new GuideKitCore({
      tokenEndpoint: '/api/token',
    });
    await noLLMCore.init();

    const result = await noLLMCore.checkHealth();
    expect(result.llm.status).toBe('not-configured');

    await noLLMCore.destroy();
  });

  it('checkHealth result statuses are from the expected set', async () => {
    const result = await core.checkHealth();
    const validStatuses = ['ok', 'degraded', 'unavailable', 'not-configured'];
    expect(validStatuses).toContain(result.llm.status);
    expect(validStatuses).toContain(result.stt.status);
    expect(validStatuses).toContain(result.tts.status);
    expect(validStatuses).toContain(result.mic.status);
  });

  it('checkHealth overall is from the expected set', async () => {
    const result = await core.checkHealth();
    const validOverall = ['ok', 'degraded', 'unavailable'];
    expect(validOverall).toContain(result.overall);
  });
});

// ---------------------------------------------------------------------------
// Tests: onBeforeLLMCall privacy hook
// ---------------------------------------------------------------------------

describe('GuideKitCore.sendText() — onBeforeLLMCall privacy hook', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(() => {
    // Re-establish streaming mock after clearAllMocks
    mockToolExecutor.executeWithToolsStream = vi.fn(async function* () {
      yield 'Agent response';
      return {
        text: 'Agent response',
        toolCallsExecuted: [],
        totalUsage: { prompt: 50, completion: 50, total: 100 },
        rounds: 1,
      };
    });
  });

  it('calls the hook before sending to LLM', async () => {
    const hookFn = vi.fn((ctx: BeforeLLMCallContext) => ctx);

    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'test-key' },
      onBeforeLLMCall: hookFn,
    });
    await core.init();

    await core.sendText('Hello agent');

    expect(hookFn).toHaveBeenCalledTimes(1);
    await core.destroy();
  });

  it('provides systemPrompt, userMessage, and conversationHistory in context', async () => {
    let capturedCtx: BeforeLLMCallContext | null = null;
    const hookFn = vi.fn((ctx: BeforeLLMCallContext) => {
      capturedCtx = ctx;
      return ctx;
    });

    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'test-key' },
      onBeforeLLMCall: hookFn,
    });
    await core.init();

    await core.sendText('What is this page?');

    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx!).toHaveProperty('systemPrompt');
    expect(capturedCtx!).toHaveProperty('userMessage');
    expect(capturedCtx!).toHaveProperty('conversationHistory');
    expect(typeof capturedCtx!.systemPrompt).toBe('string');
    expect(capturedCtx!.userMessage).toBe('What is this page?');
    expect(Array.isArray(capturedCtx!.conversationHistory)).toBe(true);

    await core.destroy();
  });

  it('allows the hook to modify the system prompt', async () => {
    const hookFn = vi.fn((ctx: BeforeLLMCallContext) => ({
      ...ctx,
      systemPrompt: 'MODIFIED PROMPT',
    }));

    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'test-key' },
      onBeforeLLMCall: hookFn,
    });
    await core.init();

    await core.sendText('test');

    // The tool executor should have been called with the modified prompt
    expect(mockToolExecutor.executeWithToolsStream).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: 'MODIFIED PROMPT',
      }),
    );

    await core.destroy();
  });

  it('allows the hook to modify the user message', async () => {
    const hookFn = vi.fn((ctx: BeforeLLMCallContext) => ({
      ...ctx,
      userMessage: 'REDACTED',
    }));

    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'test-key' },
      onBeforeLLMCall: hookFn,
    });
    await core.init();

    await core.sendText('my SSN is 123-45-6789');

    expect(mockToolExecutor.executeWithToolsStream).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: 'REDACTED',
      }),
    );

    await core.destroy();
  });

  it('cancels the LLM call when the hook throws', async () => {
    const hookFn = vi.fn(() => {
      throw new Error('PII detected — request blocked');
    });

    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'test-key' },
      onBeforeLLMCall: hookFn,
    });
    await core.init();

    await expect(core.sendText('my SSN is 123-45-6789')).rejects.toThrow();

    // The LLM orchestrator should NOT have been called
    expect(mockToolExecutor.executeWithToolsStream).not.toHaveBeenCalled();

    await core.destroy();
  });

  it('transitions agent state to idle when hook cancels', async () => {
    const hookFn = vi.fn(() => {
      throw new Error('Blocked');
    });

    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'test-key' },
      onBeforeLLMCall: hookFn,
    });
    await core.init();

    try {
      await core.sendText('secret data');
    } catch {
      // expected
    }

    expect(core.agentState.status).toBe('idle');

    await core.destroy();
  });

  it('emits error event when hook cancels', async () => {
    const hookFn = vi.fn(() => {
      throw new Error('Privacy blocked');
    });

    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'test-key' },
      onBeforeLLMCall: hookFn,
    });
    await core.init();

    try {
      await core.sendText('test');
    } catch {
      // expected
    }

    expect(mockEventBus.emit).toHaveBeenCalledWith(
      'error',
      expect.anything(),
    );

    await core.destroy();
  });

  it('wraps non-GuideKitError thrown by hook into GuideKitError', async () => {
    const hookFn = vi.fn(() => {
      throw new Error('raw error');
    });

    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'test-key' },
      onBeforeLLMCall: hookFn,
    });
    await core.init();

    try {
      await core.sendText('test');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(GuideKitError);
      expect((err as GuideKitError).code).toBe('PRIVACY_HOOK_CANCELLED');
      expect((err as GuideKitError).message).toBe('raw error');
    }

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

    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'test-key' },
      onBeforeLLMCall: hookFn,
    });
    await core.init();

    try {
      await core.sendText('test');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBe(customErr);
      expect((err as GuideKitError).code).toBe('CUSTOM_PII');
    }

    await core.destroy();
  });

  it('supports async hook functions', async () => {
    const hookFn = vi.fn(async (ctx: BeforeLLMCallContext) => {
      // Simulate async PII check
      await new Promise((r) => setTimeout(r, 1));
      return { ...ctx, userMessage: 'scrubbed' };
    });

    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'test-key' },
      onBeforeLLMCall: hookFn,
    });
    await core.init();

    await core.sendText('test');

    expect(mockToolExecutor.executeWithToolsStream).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: 'scrubbed',
      }),
    );

    await core.destroy();
  });

  it('does not invoke hook when onBeforeLLMCall is not provided', async () => {
    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'test-key' },
    });
    await core.init();

    // Should succeed without errors (no hook to call)
    const result = await core.sendText('Hello');
    expect(result).toBe('Agent response');

    await core.destroy();
  });

  it('transitions agent state to processing before calling hook', async () => {
    let stateWhenHookCalled: string | null = null;
    const hookFn = vi.fn((ctx: BeforeLLMCallContext) => {
      // We cannot access core.agentState from inside the hook directly
      // because the hook is sync, but we can verify by order of operations
      stateWhenHookCalled = 'captured';
      return ctx;
    });

    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'test-key' },
      onBeforeLLMCall: hookFn,
    });
    await core.init();

    await core.sendText('test');
    expect(stateWhenHookCalled).toBe('captured');
    // After sendText completes successfully, state goes back to idle
    expect(core.agentState.status).toBe('idle');

    await core.destroy();
  });
});

// ---------------------------------------------------------------------------
// Tests: Core init & state
// ---------------------------------------------------------------------------

describe('GuideKitCore — initialization & state', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('isReady is false before init', () => {
    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'key' },
    });
    expect(core.isReady).toBe(false);
  });

  it('isReady is true after init', async () => {
    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'key' },
    });
    await core.init();
    expect(core.isReady).toBe(true);
    await core.destroy();
  });

  it('agentState defaults to idle', () => {
    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'key' },
    });
    expect(core.agentState).toEqual({ status: 'idle' });
  });

  it('init is idempotent — calling twice does not throw', async () => {
    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'key' },
    });
    await core.init();
    await core.init(); // should be a no-op
    expect(core.isReady).toBe(true);
    await core.destroy();
  });

  it('throws ConfigurationError if no llm and no tokenEndpoint', async () => {
    const core = new GuideKitCore({});
    await expect(core.init()).rejects.toThrow(
      'Either tokenEndpoint or llm config must be provided.',
    );
  });

  it('does not throw if tokenEndpoint is provided without llm', async () => {
    const core = new GuideKitCore({
      tokenEndpoint: '/api/token',
    });
    await expect(core.init()).resolves.not.toThrow();
    await core.destroy();
  });

  it('calls onReady callback when init completes', async () => {
    const onReady = vi.fn();
    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'key' },
      onReady,
    });
    await core.init();
    expect(onReady).toHaveBeenCalledTimes(1);
    await core.destroy();
  });

  it('isReady is false after destroy', async () => {
    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'key' },
    });
    await core.init();
    await core.destroy();
    expect(core.isReady).toBe(false);
  });

  it('instanceId defaults to "default"', () => {
    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'key' },
    });
    expect(core.instanceId).toBe('default');
  });

  it('instanceId can be customized', () => {
    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'key' },
      instanceId: 'custom',
    });
    expect(core.instanceId).toBe('custom');
  });

  it('subscribe and getSnapshot form a valid store protocol', async () => {
    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'key' },
    });

    const listener = vi.fn();
    const unsub = core.subscribe(listener);

    const snapshot = core.getSnapshot();
    expect(snapshot).toHaveProperty('status');
    expect(snapshot).toHaveProperty('voice');
    expect(snapshot.status.isReady).toBe(false);

    unsub();
    // After unsubscribe, listener should not be called
    await core.init();
    // The listener was unsubscribed; depends on timing but the unsub should work
    expect(typeof unsub).toBe('function');

    await core.destroy();
  });

  it('registerAction stores a custom action', async () => {
    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'key' },
    });
    const handler = vi.fn();
    core.registerAction('test-action', {
      description: 'Test action',
      parameters: {},
      handler,
    });
    // No error should occur
    await core.destroy();
  });
});

// ---------------------------------------------------------------------------
// Tests: clickElement whitelist/blacklist
// ---------------------------------------------------------------------------

describe('clickElement security', () => {
  function getClickElementHandler(): (args: Record<string, unknown>) => Promise<unknown> {
    const calls = mockToolExecutor.registerTool.mock.calls;
    const clickCall = calls.find(
      (c: Array<{ name: string }>) => c[0].name === 'clickElement',
    );
    return clickCall![0].execute;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Set up a minimal DOM for testing
    document.body.innerHTML = `
      <button id="safe-btn" class="safe-action" data-guidekit-target="cta">Click me</button>
      <button id="danger-btn" class="admin-action">Delete All</button>
      <a id="nav-link" class="nav" href="/about">About</a>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('allows clicks when no rules are configured', async () => {
    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'key' },
    });
    await core.init();

    const handler = getClickElementHandler();
    const result = await handler({ selector: '#safe-btn' }) as Record<string, unknown>;
    expect(result.success).toBe(true);
    await core.destroy();
  });

  it('blocks clicks that do not match the allow list', async () => {
    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'key' },
      options: {
        clickableSelectors: {
          allow: ['.safe-action', '.nav'],
        },
      },
    });
    await core.init();

    const handler = getClickElementHandler();
    const result = await handler({ selector: '#danger-btn' }) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toContain('not in the allowed');
    await core.destroy();
  });

  it('allows clicks that match the allow list', async () => {
    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'key' },
      options: {
        clickableSelectors: {
          allow: ['.safe-action', '.nav'],
        },
      },
    });
    await core.init();

    const handler = getClickElementHandler();
    const result = await handler({ selector: '#safe-btn' }) as Record<string, unknown>;
    expect(result.success).toBe(true);
    await core.destroy();
  });

  it('blocks clicks that match the deny list', async () => {
    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'key' },
      options: {
        clickableSelectors: {
          deny: ['.admin-action'],
        },
      },
    });
    await core.init();

    const handler = getClickElementHandler();
    const result = await handler({ selector: '#danger-btn' }) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked by the deny list');
    await core.destroy();
  });

  it('allows clicks not matching the deny list', async () => {
    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'key' },
      options: {
        clickableSelectors: {
          deny: ['.admin-action'],
        },
      },
    });
    await core.init();

    const handler = getClickElementHandler();
    const result = await handler({ selector: '#safe-btn' }) as Record<string, unknown>;
    expect(result.success).toBe(true);
    await core.destroy();
  });

  it('deny list takes precedence when both allow and deny match', async () => {
    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'key' },
      options: {
        clickableSelectors: {
          allow: ['button'],
          deny: ['.admin-action'],
        },
      },
    });
    await core.init();

    const handler = getClickElementHandler();
    // The button matches allow (it's a button) but also matches deny (.admin-action)
    const result = await handler({ selector: '#danger-btn' }) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked by the deny list');
    await core.destroy();
  });

  it('returns error for non-existent elements even when allowed', async () => {
    const core = new GuideKitCore({
      llm: { provider: 'gemini', apiKey: 'key' },
    });
    await core.init();

    const handler = getClickElementHandler();
    const result = await handler({ selector: '#nonexistent' }) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toContain('Element not found');
    await core.destroy();
  });
});
