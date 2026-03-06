// ---------------------------------------------------------------------------
// @guidekit/react/testing — Testing utilities for apps using GuideKit
// ---------------------------------------------------------------------------
//
// Provides MockGuideKitProvider and simulate* helpers so consumers can test
// components that depend on GuideKit hooks without spinning up a real
// GuideKitCore instance.
//
// Usage:
//   import { MockGuideKitProvider, simulateAgentResponse } from '@guidekit/react/testing';
//
//   render(
//     <MockGuideKitProvider initialState={{ isReady: true }}>
//       <MyComponent />
//     </MockGuideKitProvider>
//   );
//
//   simulateAgentResponse('Hello from the agent!');
// ---------------------------------------------------------------------------

import { useRef } from 'react';
import type { ReactNode } from 'react';
import type { AgentState, GuideKitStore, GuideKitErrorType } from '@guidekit/core';

import { GuideKitContext } from './_context.js';

// ---------------------------------------------------------------------------
// Default store snapshot
// ---------------------------------------------------------------------------

const DEFAULT_STORE: GuideKitStore = {
  status: {
    isReady: false,
    agentState: { status: 'idle' },
    error: null,
  },
  voice: {
    isListening: false,
    isSpeaking: false,
  },
  streaming: {
    isStreaming: false,
    streamingText: '',
  },
};

// ---------------------------------------------------------------------------
// TestStore — a minimal external store compatible with useSyncExternalStore
// ---------------------------------------------------------------------------

/** @internal */
export class TestStore {
  private listeners = new Set<() => void>();
  private _state: GuideKitStore;

  constructor(initial?: Partial<GuideKitStore['status']>) {
    this._state = {
      status: {
        isReady: initial?.isReady ?? DEFAULT_STORE.status.isReady,
        agentState: initial?.agentState ?? DEFAULT_STORE.status.agentState,
        error: initial?.error ?? DEFAULT_STORE.status.error,
      },
      voice: {
        isListening: false,
        isSpeaking: false,
      },
      streaming: {
        isStreaming: false,
        streamingText: '',
      },
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): GuideKitStore => {
    return this._state;
  };

  setState(updater: (prev: GuideKitStore) => GuideKitStore): void {
    const next = updater(this._state);
    if (next !== this._state) {
      this._state = next;
      this.emitChange();
    }
  }

  /** Replace the state entirely. */
  setStateDirectly(next: GuideKitStore): void {
    if (next !== this._state) {
      this._state = next;
      this.emitChange();
    }
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

// ---------------------------------------------------------------------------
// Global test store — shared across simulate* functions
// ---------------------------------------------------------------------------

let _testStore: TestStore | null = null;

function requireTestStore(): TestStore {
  if (!_testStore) {
    throw new Error(
      '[GuideKit Testing] No MockGuideKitProvider is mounted. ' +
        'Wrap your component in <MockGuideKitProvider> before calling simulate* functions.',
    );
  }
  return _testStore;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Initial state for the mock provider. */
export interface MockInitialState {
  isReady?: boolean;
  agentState?: AgentState;
  error?: GuideKitErrorType | null;
}

/** Mock action implementations to inject into the provider. */
export interface MockActions {
  sendText?: (text: string) => Promise<string>;
  sendTextStream?: (text: string) => { stream: AsyncIterable<string>; done: Promise<{ fullText: string; totalTokens: number; toolCallsExecuted: number; rounds: number }> };
  highlight?: (params: {
    sectionId?: string;
    selector?: string;
    tooltip?: string;
    position?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
  }) => void;
  dismissHighlight?: () => void;
  scrollToSection?: (sectionId: string, offset?: number) => void;
  startTour?: (sectionIds: string[], mode?: 'auto' | 'manual') => void;
  navigate?: (href: string) => Promise<boolean>;
  setPageContext?: (context: Record<string, unknown>) => void;
  registerAction?: (
    actionId: string,
    action: {
      description: string;
      parameters: Record<string, unknown>;
      handler: (params: Record<string, unknown>) => Promise<unknown>;
    },
  ) => void;
  startListening?: () => Promise<void>;
  stopListening?: () => void;
}

/** Props for MockGuideKitProvider. */
export interface MockGuideKitProviderProps {
  initialState?: MockInitialState;
  actions?: MockActions;
  children: ReactNode;
}

// ---------------------------------------------------------------------------
// Noop stubs
// ---------------------------------------------------------------------------

const noopVoid = () => {};
const noopAsync = () => Promise.resolve();
const noopAsyncString = () => Promise.resolve('');
const noopAsyncBool = () => Promise.resolve(true);

// ---------------------------------------------------------------------------
// MockGuideKitProvider
// ---------------------------------------------------------------------------

/**
 * A mock provider for testing components that use GuideKit hooks.
 *
 * Instead of creating a real GuideKitCore instance (which requires API keys,
 * browser APIs, etc.), this provider supplies a lightweight mock object that
 * satisfies the context contract used by all hooks in `@guidekit/react`.
 *
 * All actions default to noops but can be overridden with mock functions
 * (e.g. `vi.fn()`).
 *
 * The provider injects the mock into the same `GuideKitContext` that the
 * real hooks read from (imported from `./_context.js`), so hooks like
 * `useGuideKitStatus`, `useGuideKitVoice`, etc. work seamlessly.
 *
 * @example
 * ```tsx
 * import { MockGuideKitProvider } from '@guidekit/react/testing';
 *
 * render(
 *   <MockGuideKitProvider
 *     initialState={{ isReady: true, agentState: { status: 'idle' } }}
 *     actions={{ sendText: vi.fn() }}
 *   >
 *     <ComponentUnderTest />
 *   </MockGuideKitProvider>
 * );
 * ```
 */
export function MockGuideKitProvider({
  initialState,
  actions,
  children,
}: MockGuideKitProviderProps) {
  // Create a TestStore on first render, keep it stable across re-renders.
  const storeRef = useRef<TestStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = new TestStore(initialState);
  }

  // Register as the global test store so simulate* functions can find it.
  _testStore = storeRef.current;

  const store = storeRef.current;

  // Build the mock object that duck-types as GuideKitCore.
  // Kept stable via a ref so the context value identity does not change.
  const mockCoreRef = useRef<Record<string, unknown> | null>(null);
  if (mockCoreRef.current === null) {
    mockCoreRef.current = {
      // Store protocol (useSyncExternalStore)
      subscribe: store.subscribe,
      getSnapshot: store.getSnapshot,

      // Actions
      sendText: actions?.sendText ?? noopAsyncString,
      sendTextStream: actions?.sendTextStream ?? (() => ({
        stream: (async function* () { /* empty stream */ })(),
        done: Promise.resolve({ fullText: '', totalTokens: 0, toolCallsExecuted: 0, rounds: 0 }),
      })),
      highlight: actions?.highlight ?? noopVoid,
      dismissHighlight: actions?.dismissHighlight ?? noopVoid,
      scrollToSection: actions?.scrollToSection ?? noopVoid,
      startTour: actions?.startTour ?? noopVoid,
      navigate: actions?.navigate ?? noopAsyncBool,
      setPageContext: actions?.setPageContext ?? noopVoid,
      registerAction: actions?.registerAction ?? noopVoid,
      startListening: actions?.startListening ?? noopAsync,
      stopListening: actions?.stopListening ?? noopVoid,

      // Read-only properties
      hasVoice: false,
      instanceId: 'mock-test-instance',
      isReady: initialState?.isReady ?? false,
      agentState: initialState?.agentState ?? { status: 'idle' as const },

      // i18n stub (used by the widget internals)
      i18n: { t: (key: string) => key },

      // Lifecycle stubs
      init: noopAsync,
      destroy: noopAsync,
    };
  }

  // Provide the mock into the same GuideKitContext that the real hooks
  // consume, so useGuideKitStatus, useGuideKitVoice, etc. all work.
  return (
    <GuideKitContext.Provider value={mockCoreRef.current as any}>
      {children}
    </GuideKitContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// simulate* functions — update the global test store
// ---------------------------------------------------------------------------

/**
 * Simulates an assistant response being added to the agent state.
 * Sets the agent state to `{ status: 'speaking', utterance: text }`.
 *
 * Subscribers (e.g. hooks using `useSyncExternalStore`) are notified
 * synchronously, so assertions can run immediately after this call.
 */
export function simulateAgentResponse(text: string): void {
  const store = requireTestStore();

  store.setState((prev) => ({
    ...prev,
    status: {
      ...prev.status,
      agentState: { status: 'speaking', utterance: text } as AgentState,
    },
  }));
}

/**
 * Simulates a voice transcript arriving (as if the user spoke).
 * Sets the agent state to `{ status: 'processing', transcript: text }`
 * and marks `voice.isListening` as `false`.
 */
export function simulateVoiceInput(text: string): void {
  const store = requireTestStore();

  store.setState((prev) => ({
    ...prev,
    status: {
      ...prev.status,
      agentState: { status: 'processing', transcript: text } as AgentState,
    },
    voice: {
      ...prev.voice,
      isListening: false,
    },
  }));
}

/**
 * Simulates an error occurring in the agent.
 * Sets the agent state to `{ status: 'error', error }` and populates
 * the store-level `error` field.
 */
export function simulateError(error: GuideKitErrorType): void {
  const store = requireTestStore();

  store.setState((prev) => ({
    ...prev,
    status: {
      ...prev.status,
      agentState: { status: 'error', error } as AgentState,
      error,
    },
  }));
}

/**
 * Returns the current mock store state. Useful for assertions in tests.
 *
 * @example
 * ```ts
 * const state = getGuideKitTestState();
 * expect(state.status.isReady).toBe(true);
 * ```
 */
export function getGuideKitTestState(): GuideKitStore {
  const store = requireTestStore();
  return store.getSnapshot();
}

// ---------------------------------------------------------------------------
// Additional helpers
// ---------------------------------------------------------------------------

/**
 * Resets the agent state back to idle and clears any error.
 * Useful for cleaning up between simulate* calls in a test.
 */
export function resetAgentState(): void {
  const store = requireTestStore();

  store.setState((prev) => ({
    ...prev,
    status: {
      ...prev.status,
      agentState: { status: 'idle' } as AgentState,
      error: null,
    },
    voice: {
      isListening: false,
      isSpeaking: false,
    },
  }));
}

/**
 * Sets the `isReady` flag on the mock store. Useful to simulate the SDK
 * finishing initialization.
 */
export function simulateReady(isReady: boolean = true): void {
  const store = requireTestStore();

  store.setState((prev) => ({
    ...prev,
    status: {
      ...prev.status,
      isReady,
    },
  }));
}

/**
 * Returns the raw TestStore instance for advanced use cases (e.g.,
 * subscribing to changes directly or calling `setState` with a custom
 * updater). Returns `null` if no MockGuideKitProvider is mounted.
 */
export function getTestStore_UNSAFE(): TestStore | null {
  return _testStore;
}

/**
 * Cleans up the global test store reference. Call this in `afterEach` or
 * `afterAll` to prevent state leaking between tests.
 */
export function cleanupTestStore(): void {
  _testStore = null;
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------

export type { AgentState, GuideKitStore, GuideKitErrorType };
