// ---------------------------------------------------------------------------
// @guidekit/react/testing — Unit tests
// ---------------------------------------------------------------------------
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import ReactDOMClient from 'react-dom/client';
import { flushSync } from 'react-dom';

import {
  TestStore,
  MockGuideKitProvider,
  simulateAgentResponse,
  simulateVoiceInput,
  simulateError,
  getGuideKitTestState,
  resetAgentState,
  simulateReady,
  getTestStore_UNSAFE,
  cleanupTestStore,
} from './testing.js';
import type {
  AgentState,
  GuideKitStore,
  GuideKitErrorType,
} from './testing.js';

// ---------------------------------------------------------------------------
// Helper: render MockGuideKitProvider synchronously
// ---------------------------------------------------------------------------

function renderProvider(
  props?: {
    initialState?: { isReady?: boolean; agentState?: AgentState; error?: GuideKitErrorType | null };
    actions?: Record<string, unknown>;
    children?: React.ReactNode;
  },
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOMClient.createRoot(container);

  flushSync(() => {
    root.render(
      React.createElement(
        MockGuideKitProvider,
        {
          initialState: props?.initialState,
          actions: props?.actions,
          children:
            props?.children ??
            React.createElement('span', null, 'child'),
        },
      ),
    );
  });

  return { container, root };
}

// ---------------------------------------------------------------------------
// Helper: create a mock error that satisfies GuideKitErrorType
// ---------------------------------------------------------------------------

function createMockError(overrides?: Partial<GuideKitErrorType>): GuideKitErrorType {
  const err = new Error(overrides?.message ?? 'test error') as any;
  err.code = overrides?.code ?? 'TEST_ERR';
  err.recoverable = overrides?.recoverable ?? true;
  err.suggestion = overrides?.suggestion ?? 'fix it';
  err.docsUrl = overrides?.docsUrl ?? 'https://example.com';
  if (overrides?.provider) err.provider = overrides.provider;
  return err as GuideKitErrorType;
}

// ---------------------------------------------------------------------------
// Tests: TestStore (internal store class)
// ---------------------------------------------------------------------------

describe('TestStore', () => {
  it('creates with default state when no initial provided', () => {
    const store = new TestStore();
    const snap = store.getSnapshot();
    expect(snap.status.isReady).toBe(false);
    expect(snap.status.agentState).toEqual({ status: 'idle' });
    expect(snap.status.error).toBeNull();
    expect(snap.voice.isListening).toBe(false);
    expect(snap.voice.isSpeaking).toBe(false);
  });

  it('creates with custom initial isReady', () => {
    const store = new TestStore({ isReady: true });
    expect(store.getSnapshot().status.isReady).toBe(true);
  });

  it('creates with custom initial agentState', () => {
    const state: AgentState = { status: 'listening', durationMs: 500 };
    const store = new TestStore({ agentState: state });
    expect(store.getSnapshot().status.agentState).toEqual(state);
  });

  it('creates with custom initial error', () => {
    const error = createMockError({ code: 'TEST_ERR' });
    const store = new TestStore({ error });
    expect(store.getSnapshot().status.error).toBe(error);
  });

  it('voice defaults to not listening / not speaking', () => {
    const store = new TestStore({ isReady: true });
    expect(store.getSnapshot().voice).toEqual({
      isListening: false,
      isSpeaking: false,
    });
  });

  it('subscribe returns an unsubscribe function', () => {
    const store = new TestStore();
    const unsub = store.subscribe(vi.fn());
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('notifies listeners when state changes via setState', () => {
    const store = new TestStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState((prev) => ({
      ...prev,
      status: { ...prev.status, isReady: true },
    }));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify listeners when setState returns same reference', () => {
    const store = new TestStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState((prev) => prev);

    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies multiple listeners', () => {
    const store = new TestStore();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    store.subscribe(listener1);
    store.subscribe(listener2);

    store.setState((prev) => ({
      ...prev,
      status: { ...prev.status, isReady: true },
    }));

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe prevents further notifications', () => {
    const store = new TestStore();
    const listener = vi.fn();
    const unsub = store.subscribe(listener);

    unsub();

    store.setState((prev) => ({
      ...prev,
      status: { ...prev.status, isReady: true },
    }));

    expect(listener).not.toHaveBeenCalled();
  });

  it('getSnapshot returns current state after setState', () => {
    const store = new TestStore();
    store.setState((prev) => ({
      ...prev,
      status: { ...prev.status, isReady: true },
    }));
    expect(store.getSnapshot().status.isReady).toBe(true);
  });

  it('setStateDirectly replaces the entire state', () => {
    const store = new TestStore();
    const newState: GuideKitStore = {
      status: {
        isReady: true,
        agentState: { status: 'speaking', utterance: 'hi' },
        error: null,
      },
      voice: { isListening: false, isSpeaking: true },
    };

    store.setStateDirectly(newState);
    expect(store.getSnapshot()).toBe(newState);
  });

  it('setStateDirectly notifies listeners', () => {
    const store = new TestStore();
    const listener = vi.fn();
    store.subscribe(listener);

    const newState: GuideKitStore = {
      status: {
        isReady: true,
        agentState: { status: 'idle' },
        error: null,
      },
      voice: { isListening: false, isSpeaking: false },
    };

    store.setStateDirectly(newState);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('setStateDirectly does not notify when same reference is passed', () => {
    const store = new TestStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const current = store.getSnapshot();

    store.setStateDirectly(current);
    expect(listener).not.toHaveBeenCalled();
  });

  it('supports chaining multiple setState calls', () => {
    const store = new TestStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState((prev) => ({
      ...prev,
      status: { ...prev.status, isReady: true },
    }));
    store.setState((prev) => ({
      ...prev,
      status: { ...prev.status, agentState: { status: 'listening', durationMs: 0 } },
    }));

    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().status.isReady).toBe(true);
    expect(store.getSnapshot().status.agentState.status).toBe('listening');
  });

  it('initial state with processing agentState', () => {
    const store = new TestStore({
      agentState: { status: 'processing', transcript: 'user said something' },
    });
    const snap = store.getSnapshot();
    expect(snap.status.agentState.status).toBe('processing');
    if (snap.status.agentState.status === 'processing') {
      expect(snap.status.agentState.transcript).toBe('user said something');
    }
  });

  it('initial state with speaking agentState', () => {
    const store = new TestStore({
      agentState: { status: 'speaking', utterance: 'hello world' },
    });
    const snap = store.getSnapshot();
    expect(snap.status.agentState.status).toBe('speaking');
    if (snap.status.agentState.status === 'speaking') {
      expect(snap.status.agentState.utterance).toBe('hello world');
    }
  });

  it('initial state with error agentState', () => {
    const error = createMockError({ code: 'INIT_FAIL' });
    const store = new TestStore({
      agentState: { status: 'error', error },
    });
    const snap = store.getSnapshot();
    expect(snap.status.agentState.status).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// Tests: simulate* functions (without provider)
// ---------------------------------------------------------------------------

describe('simulate* functions — before provider is mounted', () => {
  beforeEach(() => {
    cleanupTestStore();
  });

  it('simulateAgentResponse throws when no provider is mounted', () => {
    expect(() => simulateAgentResponse('hello')).toThrow(
      'No MockGuideKitProvider is mounted',
    );
  });

  it('simulateVoiceInput throws when no provider is mounted', () => {
    expect(() => simulateVoiceInput('hello')).toThrow(
      'No MockGuideKitProvider is mounted',
    );
  });

  it('simulateError throws when no provider is mounted', () => {
    const error = createMockError();
    expect(() => simulateError(error)).toThrow(
      'No MockGuideKitProvider is mounted',
    );
  });

  it('getGuideKitTestState throws when no provider is mounted', () => {
    expect(() => getGuideKitTestState()).toThrow(
      'No MockGuideKitProvider is mounted',
    );
  });

  it('resetAgentState throws when no provider is mounted', () => {
    expect(() => resetAgentState()).toThrow(
      'No MockGuideKitProvider is mounted',
    );
  });

  it('simulateReady throws when no provider is mounted', () => {
    expect(() => simulateReady()).toThrow(
      'No MockGuideKitProvider is mounted',
    );
  });

  it('getTestStore_UNSAFE returns null when no provider is mounted', () => {
    expect(getTestStore_UNSAFE()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: simulate* functions with provider
// ---------------------------------------------------------------------------

describe('simulate* functions — with TestStore', () => {
  let store: TestStore;

  beforeEach(() => {
    cleanupTestStore();
    renderProvider({ initialState: { isReady: false } });
    store = getTestStore_UNSAFE()!;
  });

  afterEach(() => {
    cleanupTestStore();
    document.body.innerHTML = '';
  });

  it('getTestStore_UNSAFE returns the test store after provider mounts', () => {
    expect(store).toBeDefined();
    expect(store).not.toBeNull();
    expect(store).toBeInstanceOf(TestStore);
  });

  // ---- simulateAgentResponse ----

  it('simulateAgentResponse sets agent state to speaking', () => {
    simulateAgentResponse('Hello from agent');
    const state = getGuideKitTestState();
    expect(state.status.agentState).toEqual({
      status: 'speaking',
      utterance: 'Hello from agent',
    });
  });

  it('simulateAgentResponse notifies store listeners', () => {
    const listener = vi.fn();
    store.subscribe(listener);
    simulateAgentResponse('test');
    expect(listener).toHaveBeenCalled();
  });

  it('simulateAgentResponse preserves isReady', () => {
    simulateReady(true);
    simulateAgentResponse('hi');
    expect(getGuideKitTestState().status.isReady).toBe(true);
  });

  it('simulateAgentResponse with empty string', () => {
    simulateAgentResponse('');
    const state = getGuideKitTestState();
    expect(state.status.agentState).toEqual({
      status: 'speaking',
      utterance: '',
    });
  });

  it('simulateAgentResponse with long text', () => {
    const longText = 'A'.repeat(5000);
    simulateAgentResponse(longText);
    const state = getGuideKitTestState();
    if (state.status.agentState.status === 'speaking') {
      expect(state.status.agentState.utterance).toBe(longText);
    }
  });

  // ---- simulateVoiceInput ----

  it('simulateVoiceInput sets agent state to processing', () => {
    simulateVoiceInput('user spoke this');
    const state = getGuideKitTestState();
    expect(state.status.agentState).toEqual({
      status: 'processing',
      transcript: 'user spoke this',
    });
  });

  it('simulateVoiceInput sets isListening to false', () => {
    simulateVoiceInput('hello');
    expect(getGuideKitTestState().voice.isListening).toBe(false);
  });

  it('simulateVoiceInput preserves error state if present', () => {
    const error = createMockError();
    simulateError(error);
    simulateVoiceInput('after error');
    const state = getGuideKitTestState();
    expect(state.status.agentState.status).toBe('processing');
  });

  it('simulateVoiceInput with empty string', () => {
    simulateVoiceInput('');
    const state = getGuideKitTestState();
    expect(state.status.agentState.status).toBe('processing');
  });

  // ---- simulateError ----

  it('simulateError sets agent state to error', () => {
    const error = createMockError({ code: 'NETWORK_ERROR', message: 'Connection lost' });
    simulateError(error);
    const state = getGuideKitTestState();
    expect(state.status.agentState.status).toBe('error');
  });

  it('simulateError populates the store-level error field', () => {
    const error = createMockError({ code: 'TEST', message: 'Test error' });
    simulateError(error);
    const state = getGuideKitTestState();
    expect(state.status.error).toBe(error);
  });

  it('simulateError error is accessible on agentState', () => {
    const error = createMockError({ code: 'X' });
    simulateError(error);
    const state = getGuideKitTestState();
    if (state.status.agentState.status === 'error') {
      expect(state.status.agentState.error).toBe(error);
    } else {
      expect.unreachable('agentState should be in error status');
    }
  });

  it('simulateError notifies listeners', () => {
    const listener = vi.fn();
    store.subscribe(listener);
    const error = createMockError();
    simulateError(error);
    expect(listener).toHaveBeenCalled();
  });

  // ---- getGuideKitTestState ----

  it('getGuideKitTestState returns the current snapshot', () => {
    const state = getGuideKitTestState();
    expect(state).toHaveProperty('status');
    expect(state).toHaveProperty('voice');
  });

  it('getGuideKitTestState reflects mutations from simulate* calls', () => {
    simulateReady(true);
    expect(getGuideKitTestState().status.isReady).toBe(true);

    simulateAgentResponse('hi');
    expect(getGuideKitTestState().status.agentState.status).toBe('speaking');
  });

  it('getGuideKitTestState returns status and voice properties', () => {
    const state = getGuideKitTestState();
    expect(state.status).toHaveProperty('isReady');
    expect(state.status).toHaveProperty('agentState');
    expect(state.status).toHaveProperty('error');
    expect(state.voice).toHaveProperty('isListening');
    expect(state.voice).toHaveProperty('isSpeaking');
  });

  // ---- resetAgentState ----

  it('resetAgentState sets agent state to idle', () => {
    simulateAgentResponse('hello');
    resetAgentState();
    expect(getGuideKitTestState().status.agentState).toEqual({ status: 'idle' });
  });

  it('resetAgentState clears the error', () => {
    const error = createMockError();
    simulateError(error);
    resetAgentState();
    expect(getGuideKitTestState().status.error).toBeNull();
  });

  it('resetAgentState resets voice state', () => {
    resetAgentState();
    const state = getGuideKitTestState();
    expect(state.voice.isListening).toBe(false);
    expect(state.voice.isSpeaking).toBe(false);
  });

  it('resetAgentState preserves isReady', () => {
    simulateReady(true);
    simulateAgentResponse('test');
    resetAgentState();
    expect(getGuideKitTestState().status.isReady).toBe(true);
  });

  it('resetAgentState from error state', () => {
    const error = createMockError();
    simulateError(error);
    expect(getGuideKitTestState().status.error).not.toBeNull();
    resetAgentState();
    expect(getGuideKitTestState().status.error).toBeNull();
    expect(getGuideKitTestState().status.agentState.status).toBe('idle');
  });

  // ---- simulateReady ----

  it('simulateReady(true) sets isReady to true', () => {
    simulateReady(true);
    expect(getGuideKitTestState().status.isReady).toBe(true);
  });

  it('simulateReady(false) sets isReady to false', () => {
    simulateReady(true);
    simulateReady(false);
    expect(getGuideKitTestState().status.isReady).toBe(false);
  });

  it('simulateReady() defaults to true', () => {
    simulateReady();
    expect(getGuideKitTestState().status.isReady).toBe(true);
  });

  it('simulateReady preserves agent state', () => {
    simulateAgentResponse('running');
    simulateReady(true);
    expect(getGuideKitTestState().status.agentState.status).toBe('speaking');
  });

  // ---- cleanupTestStore ----

  it('cleanupTestStore clears the global store reference', () => {
    expect(getTestStore_UNSAFE()).not.toBeNull();
    cleanupTestStore();
    expect(getTestStore_UNSAFE()).toBeNull();
  });

  it('simulate* throws after cleanupTestStore', () => {
    cleanupTestStore();
    expect(() => simulateAgentResponse('hi')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tests: MockGuideKitProvider (rendering)
// ---------------------------------------------------------------------------

describe('MockGuideKitProvider', () => {
  afterEach(() => {
    cleanupTestStore();
    document.body.innerHTML = '';
  });

  it('renders children', () => {
    const { container } = renderProvider({
      children: React.createElement('div', null, 'Hello'),
    });
    expect(container.textContent).toContain('Hello');
  });

  it('renders without initial state', () => {
    const { container } = renderProvider();
    expect(container.textContent).toContain('child');
  });

  it('sets global test store when mounted', () => {
    renderProvider();
    const store = getTestStore_UNSAFE();
    expect(store).not.toBeNull();
    expect(store).toBeInstanceOf(TestStore);
  });

  it('initialState isReady is reflected in store', () => {
    renderProvider({ initialState: { isReady: true } });
    const state = getGuideKitTestState();
    expect(state.status.isReady).toBe(true);
  });

  it('initialState agentState is reflected in store', () => {
    const agentState: AgentState = { status: 'listening', durationMs: 100 };
    renderProvider({ initialState: { agentState } });
    const state = getGuideKitTestState();
    expect(state.status.agentState).toEqual(agentState);
  });

  it('initialState error is reflected in store', () => {
    const error = createMockError({ code: 'INIT_ERR', message: 'init failed' });
    renderProvider({ initialState: { error } });
    const state = getGuideKitTestState();
    expect(state.status.error).toBe(error);
  });

  it('defaults to isReady=false when no initialState', () => {
    renderProvider();
    const state = getGuideKitTestState();
    expect(state.status.isReady).toBe(false);
  });

  it('defaults to idle agentState when no initialState', () => {
    renderProvider();
    const state = getGuideKitTestState();
    expect(state.status.agentState).toEqual({ status: 'idle' });
  });

  it('defaults to null error when no initialState', () => {
    renderProvider();
    const state = getGuideKitTestState();
    expect(state.status.error).toBeNull();
  });

  it('renders with multiple children', () => {
    const { container } = renderProvider({
      children: React.createElement(
        React.Fragment,
        null,
        React.createElement('span', null, 'first'),
        React.createElement('span', null, 'second'),
      ),
    });
    expect(container.textContent).toContain('first');
    expect(container.textContent).toContain('second');
  });
});

// ---------------------------------------------------------------------------
// Tests: full state flow (chaining multiple simulate* calls)
// ---------------------------------------------------------------------------

describe('state flow — chaining simulate* calls', () => {
  beforeEach(() => {
    cleanupTestStore();
    renderProvider({ initialState: { isReady: true } });
  });

  afterEach(() => {
    cleanupTestStore();
    document.body.innerHTML = '';
  });

  it('idle -> processing -> speaking -> idle', () => {
    expect(getGuideKitTestState().status.agentState.status).toBe('idle');

    simulateVoiceInput('what is this?');
    expect(getGuideKitTestState().status.agentState.status).toBe('processing');

    simulateAgentResponse('This is a test page.');
    expect(getGuideKitTestState().status.agentState.status).toBe('speaking');

    resetAgentState();
    expect(getGuideKitTestState().status.agentState.status).toBe('idle');
  });

  it('error then reset returns to idle', () => {
    const error = createMockError({ code: 'NETWORK', message: 'Lost connection' });

    simulateError(error);
    expect(getGuideKitTestState().status.agentState.status).toBe('error');
    expect(getGuideKitTestState().status.error).toBe(error);

    resetAgentState();
    expect(getGuideKitTestState().status.agentState.status).toBe('idle');
    expect(getGuideKitTestState().status.error).toBeNull();
  });

  it('simulateReady then simulate flow maintains isReady', () => {
    expect(getGuideKitTestState().status.isReady).toBe(true);
    simulateVoiceInput('hello');
    expect(getGuideKitTestState().status.isReady).toBe(true);
    simulateAgentResponse('world');
    expect(getGuideKitTestState().status.isReady).toBe(true);
    resetAgentState();
    expect(getGuideKitTestState().status.isReady).toBe(true);
  });

  it('multiple sequential agent responses update correctly', () => {
    simulateAgentResponse('first');
    expect(getGuideKitTestState().status.agentState).toEqual({
      status: 'speaking',
      utterance: 'first',
    });

    simulateAgentResponse('second');
    expect(getGuideKitTestState().status.agentState).toEqual({
      status: 'speaking',
      utterance: 'second',
    });
  });

  it('error -> voice input -> response -> idle', () => {
    const error = createMockError();
    simulateError(error);
    expect(getGuideKitTestState().status.agentState.status).toBe('error');

    simulateVoiceInput('try again');
    expect(getGuideKitTestState().status.agentState.status).toBe('processing');

    simulateAgentResponse('recovered');
    expect(getGuideKitTestState().status.agentState.status).toBe('speaking');

    resetAgentState();
    expect(getGuideKitTestState().status.agentState.status).toBe('idle');
  });
});
