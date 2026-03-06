/**
 * Shared test mock factories for GuideKit core tests.
 *
 * Provides reusable mock objects and helper functions so that test files
 * can import pre-built mocks instead of duplicating setup boilerplate.
 *
 * @module @guidekit/core/__test-utils__
 */

import { vi } from 'vitest';
import type { PageModel, GuideKitStore, LLMProviderAdapter, TextChunk, ToolCall } from '../types/index.js';

// ---------------------------------------------------------------------------
// Mock subsystem factories
// ---------------------------------------------------------------------------

/**
 * Create all mocked subsystems used by GuideKitCore tests.
 *
 * Each mock mirrors the public API surface of the real subsystem
 * with `vi.fn()` stubs. The returned object can be used directly
 * in `vi.mock()` factory functions.
 */
export function createCoreMocks() {
  const eventBus = createMockEventBus();
  const resourceManager = createMockResourceManager();
  const domScanner = createMockDOMScanner();
  const contextManager = createMockContextManager();
  const llmOrchestrator = createMockLLMOrchestrator();
  const toolExecutor = createMockToolExecutor();
  const connectionManager = createMockConnectionManager();
  const navigationController = createMockNavigationController();
  const visualGuidance = createMockVisualGuidance();
  const awarenessSystem = createMockAwarenessSystem();
  const proactiveEngine = createMockProactiveEngine();
  const rateLimiter = createMockRateLimiter();
  const i18n = createMockI18n();
  const tokenManager = createMockTokenManager();

  return {
    eventBus,
    resourceManager,
    domScanner,
    contextManager,
    llmOrchestrator,
    toolExecutor,
    connectionManager,
    navigationController,
    visualGuidance,
    awarenessSystem,
    proactiveEngine,
    rateLimiter,
    i18n,
    tokenManager,
  };
}

// ---------------------------------------------------------------------------
// Individual mock factories
// ---------------------------------------------------------------------------

export function createMockEventBus() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    onAny: vi.fn(),
  };
}

export function createMockResourceManager() {
  return {
    register: vi.fn(),
    markReady: vi.fn(),
  };
}

export function createMockDOMScanner() {
  return {
    scan: vi.fn(() => createMockPageModel()),
    observe: vi.fn(() => vi.fn()),
  };
}

export function createMockContextManager() {
  return {
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
}

export function createMockLLMOrchestrator() {
  return {
    sendMessage: vi.fn(),
  };
}

export function createMockToolExecutor() {
  const executor: Record<string, ReturnType<typeof vi.fn>> = {
    registerTool: vi.fn(),
    executeWithTools: vi.fn().mockResolvedValue({
      text: 'tool response',
      toolCallsExecuted: [],
      totalUsage: { prompt: 10, completion: 20, total: 30 },
      rounds: 1,
    }),
    executeWithToolsStream: vi.fn(async function* () {
      yield 'tool response';
      return {
        text: 'tool response',
        toolCallsExecuted: [],
        totalUsage: { prompt: 10, completion: 20, total: 30 },
        rounds: 1,
      };
    }),
  };
  return executor;
}

export function createMockConnectionManager() {
  return {
    onStateChange: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

export function createMockNavigationController() {
  return {
    onRouteChange: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

export function createMockVisualGuidance() {
  return {
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
}

export function createMockAwarenessSystem() {
  return {
    start: vi.fn(),
    destroy: vi.fn(),
  };
}

export function createMockProactiveEngine() {
  return {
    start: vi.fn(),
    destroy: vi.fn(),
    quietMode: false,
  };
}

export function createMockRateLimiter() {
  return {
    checkLLMCall: vi.fn(),
    getState: vi.fn(() => ({})),
  };
}

export function createMockI18n() {
  return {
    t: vi.fn((key: string) => key),
  };
}

export function createMockTokenManager() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
    token: 'mock-token',
  };
}

// ---------------------------------------------------------------------------
// Data factories
// ---------------------------------------------------------------------------

/**
 * Create a mock `PageModel` with sensible defaults.
 * Pass partial overrides to customise specific fields.
 */
export function createMockPageModel(overrides?: Partial<PageModel>): PageModel {
  return {
    url: 'https://example.com',
    title: 'Test Page',
    meta: { description: '', h1: 'Test', language: 'en' },
    sections: [],
    navigation: [],
    interactiveElements: [],
    forms: [],
    activeOverlays: [],
    viewport: { width: 1024, height: 768, orientation: 'landscape' as const },
    allSectionsSummary: [],
    hash: 'abc123',
    timestamp: Date.now(),
    scanMetadata: {
      totalSectionsFound: 0,
      sectionsIncluded: 0,
      totalNodesScanned: 0,
      scanBudgetExhausted: false,
    },
    ...overrides,
  };
}

/**
 * Create a mock `GuideKitStore` snapshot with sensible defaults.
 * Pass partial overrides to customise specific fields.
 */
export function createMockStore(overrides?: Partial<GuideKitStore>): GuideKitStore {
  return {
    status: {
      isReady: true,
      agentState: { status: 'idle' },
      error: null,
    },
    voice: {
      isListening: false,
      isSpeaking: false,
    },
    hasConsent: true,
    streaming: {
      isStreaming: false,
      streamingText: '',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// LLM response helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal text-only LLM response object for use with
 * `mockToolExecutor.executeWithTools` or similar mock return values.
 */
export function textResponse(text: string) {
  return {
    text,
    toolCallsExecuted: [],
    totalUsage: { prompt: 10, completion: 20, total: 30 },
    rounds: 1,
  };
}

/**
 * Build a single tool-call LLM response for use in mock return values.
 */
export function toolCallResponse(name: string, args: Record<string, unknown>) {
  return {
    text: '',
    toolCallsExecuted: [{ id: name, name, arguments: args }],
    totalUsage: { prompt: 15, completion: 25, total: 40 },
    rounds: 1,
  };
}

// ---------------------------------------------------------------------------
// ScriptedLLMAdapter
// ---------------------------------------------------------------------------

/**
 * Deterministic `LLMProviderAdapter` that replays a pre-defined sequence
 * of responses. Useful for testing cognitive engine / multi-turn flows
 * without hitting any real API.
 *
 * Each call to `parseResponse()` / `streamRequest()` pops the next
 * response from the queue. If the queue is exhausted, it throws.
 *
 * Usage:
 * ```ts
 * const adapter = new ScriptedLLMAdapter([
 *   { text: 'Hello!', toolCalls: [] },
 *   { text: '', toolCalls: [{ id: '1', name: 'highlight', arguments: { selector: '#hero' } }] },
 * ]);
 * ```
 */
export interface ScriptedResponse {
  text: string;
  toolCalls: ToolCall[];
  usage?: { prompt: number; completion: number; total: number };
}

export class ScriptedLLMAdapter implements LLMProviderAdapter {
  private readonly responses: ScriptedResponse[];
  private index = 0;

  constructor(responses: ScriptedResponse[]) {
    this.responses = responses;
  }

  formatTools(_tools: unknown[]): unknown {
    return undefined;
  }

  formatConversation(_history: unknown[]): unknown {
    return [];
  }

  async *parseResponse(_stream: ReadableStream): AsyncIterable<TextChunk | ToolCall> {
    const response = this.nextResponse();

    if (response.text) {
      yield { text: response.text, done: false };
    }

    for (const tc of response.toolCalls) {
      yield tc;
    }

    yield { text: '', done: true };
  }

  formatToolResult(callId: string, result: unknown): unknown {
    return { callId, result };
  }

  async streamRequest(_params: {
    systemPrompt: string;
    contents: unknown;
    userMessage?: string;
    tools?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<{ stream: ReadableStream<Uint8Array>; response: Response }> {
    // Return an empty stream — actual data is served via parseResponse.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    return { stream, response: new Response(null, { status: 200 }) };
  }

  isContentFiltered(_chunk: Record<string, unknown>): boolean {
    return false;
  }

  extractUsage(_chunk: Record<string, unknown>): { prompt: number; completion: number; total: number } | null {
    return null;
  }

  /** Get the usage from the current (most recently consumed) response. */
  get lastUsage(): { prompt: number; completion: number; total: number } {
    const idx = Math.max(0, this.index - 1);
    return this.responses[idx]?.usage ?? { prompt: 0, completion: 0, total: 0 };
  }

  /** How many responses have been consumed so far. */
  get callCount(): number {
    return this.index;
  }

  /** Reset the response index back to 0. */
  reset(): void {
    this.index = 0;
  }

  private nextResponse(): ScriptedResponse {
    if (this.index >= this.responses.length) {
      throw new Error(
        `ScriptedLLMAdapter: exhausted all ${this.responses.length} scripted responses ` +
          `(call #${this.index + 1})`,
      );
    }
    return this.responses[this.index++]!;
  }
}
