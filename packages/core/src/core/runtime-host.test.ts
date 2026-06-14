import { describe, it, expect, vi } from 'vitest';
import { VisualNavController } from './visual-nav.js';
import { buildRuntimeInitHost } from './runtime-host.js';
import type { EventBus } from '../bus/index.js';

describe('buildRuntimeInitHost', () => {
  it('preserves VisualNavController prototype methods on the init host', () => {
    const bus = { emit: vi.fn(), on: vi.fn(), onAny: vi.fn() } as unknown as EventBus;
    const visualNav = new VisualNavController(bus, () => null, () => null);
    const toolsHost = Object.assign(visualNav, {
      getPageModel: () => null,
      contextManager: {} as never,
      customActions: new Map(),
    });

    const initHost = buildRuntimeInitHost({
      instanceId: 'test',
      debug: false,
      options: {} as never,
      bus,
      resourceManager: {} as never,
      contextManager: {} as never,
      toolsHost,
      getAgentState: () => 'idle',
      setAgentState: vi.fn(),
      notifyStoreListeners: vi.fn(),
      sendText: vi.fn(),
      resolveLLMConfig: () => null,
      getToolDefinitions: () => [],
      getRefs: () => ({
        toolExecutor: null,
        domScanner: null,
        llmOrchestrator: null,
        tokenManager: null,
        connectionManager: null,
        navigationController: null,
        visualGuidance: null,
        awarenessSystem: null,
        proactiveEngine: null,
        voicePipeline: null,
        platformExtensions: null,
      }),
      setRefs: vi.fn(),
    });

    expect(typeof initHost.highlight).toBe('function');
    expect(typeof initHost.scrollToSection).toBe('function');
    expect(typeof initHost.dismissHighlight).toBe('function');
  });
});
