// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineOrchestrator } from './orchestrator.js';
import type { PipelineDependencies } from './types.js';
import { GuideKitError, ConfigurationError } from '../errors/index.js';
import {
  createMockEventBus,
  createMockContextManager,
  createMockLLMOrchestrator,
  createMockToolExecutor,
  createMockRateLimiter,
} from '../__test-utils__/index.js';

function createDeps(overrides?: Partial<PipelineDependencies>): PipelineDependencies {
  const mockLLM = createMockLLMOrchestrator();
  const mockToolExecutor = createMockToolExecutor();

  mockToolExecutor.executeWithToolsStream.mockImplementation(async function* () {
    yield 'Hello';
    yield ' world';
    return {
      totalUsage: { prompt: 10, completion: 5, total: 15 },
      toolCallsExecuted: [],
      rounds: 1,
    };
  });

  const agentState = { status: 'idle' as const };

  return {
    llmOrchestrator: mockLLM as unknown as PipelineDependencies['llmOrchestrator'],
    toolExecutor: mockToolExecutor as unknown as PipelineDependencies['toolExecutor'],
    contextManager: createMockContextManager() as unknown as PipelineDependencies['contextManager'],
    rateLimiter: createMockRateLimiter() as unknown as PipelineDependencies['rateLimiter'],
    bus: createMockEventBus() as unknown as PipelineDependencies['bus'],
    signal: new AbortController().signal,
    maxMessageLength: 10_000,
    isReady: () => true,
    getSendInFlight: () => false,
    setSendInFlight: vi.fn(),
    getPageModel: () => ({
      url: 'https://example.com',
      title: 'Test',
      sections: [],
      navItems: [],
      interactiveElements: [],
      forms: [],
      overlays: [],
      metadata: { scannedAt: Date.now(), nodeCount: 0, durationMs: 0 },
    }),
    getToolDefinitions: () => [],
    setAgentState: vi.fn((s) => {
      Object.assign(agentState, s);
    }),
    getAgentState: () => agentState,
    setStreaming: vi.fn(),
    notifyListeners: vi.fn(),
    ...overrides,
  };
}

describe('PipelineOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when SDK is not ready', () => {
    const orchestrator = new PipelineOrchestrator(
      createDeps({ isReady: () => false }),
    );
    expect(() => orchestrator.sendTextStream('hi')).toThrow(ConfigurationError);
  });

  it('throws when message is in flight', () => {
    const orchestrator = new PipelineOrchestrator(
      createDeps({ getSendInFlight: () => true }),
    );
    expect(() => orchestrator.sendTextStream('hi')).toThrow(GuideKitError);
  });

  it('streams LLM response through full pipeline', async () => {
    const deps = createDeps();
    const orchestrator = new PipelineOrchestrator(deps);
    const { stream, done } = orchestrator.sendTextStream('What is this page?');

    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const result = await done;
    expect(chunks.join('')).toBe('Hello world');
    expect(result.fullText).toBe('Hello world');
    expect(result.totalTokens).toBe(15);
    expect(deps.contextManager.addTurn).toHaveBeenCalledTimes(2);
    expect(deps.contextManager.saveSession).toHaveBeenCalled();
    expect(deps.bus.emit).toHaveBeenCalledWith(
      'llm:response-start',
      expect.objectContaining({ conversationId: expect.any(String) }),
    );
  });

  it('runs enrich hook when provided', async () => {
    const enrich = vi.fn(async (ctx) => ({
      ...ctx,
      metadata: { enriched: true },
    }));
    const deps = createDeps({ stageHooks: { enrich } });
    const orchestrator = new PipelineOrchestrator(deps);
    const { stream, done } = orchestrator.sendTextStream('test');

    for await (const _ of stream) {
      /* consume */
    }
    await done;

    expect(enrich).toHaveBeenCalled();
  });

  it('cancels when onBeforeLLMCall throws', async () => {
    const deps = createDeps({
      onBeforeLLMCall: async () => {
        throw new Error('PII detected');
      },
    });
    const orchestrator = new PipelineOrchestrator(deps);
    const { stream, done } = orchestrator.sendTextStream('secret data');

    // Stream may complete without yielding; rejection is on done.
    for await (const _ of stream) {
      /* consume if any */
    }

    await expect(done).rejects.toMatchObject({
      code: 'PRIVACY_HOOK_CANCELLED',
    });
  });
});
