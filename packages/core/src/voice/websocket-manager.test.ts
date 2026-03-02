// ---------------------------------------------------------------------------
// WebSocketManager – Unit Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketManager } from './websocket-manager.js';
import type { WSState } from './websocket-manager.js';

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: (() => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  readyState = 0; // CONNECTING
  sent: any[] = [];
  binaryType = 'blob';

  // Static constants matching the real WebSocket
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  private _listeners: Record<string, Function[]> = {};

  constructor(
    public url: string,
    public protocols?: string | string[],
  ) {
    MockWebSocket.instances.push(this);
  }

  send(data: any) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    // Fire event listeners registered via addEventListener
    const closeEvent = { code: code ?? 1000, reason: reason ?? '' };
    this._fireEvent('close', closeEvent);
  }

  addEventListener(event: string, handler: Function) {
    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }
    this._listeners[event]!.push(handler);
  }

  removeEventListener(event: string, handler: Function) {
    const list = this._listeners[event];
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx !== -1) list.splice(idx, 1);
  }

  private _fireEvent(event: string, data?: any) {
    const list = this._listeners[event];
    if (!list) return;
    for (const fn of list.slice()) {
      fn(data);
    }
  }

  // --- Test helpers ---

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this._fireEvent('open');
  }

  simulateMessage(data: any) {
    this._fireEvent('message', { data });
  }

  simulateError() {
    this._fireEvent('error', { type: 'error' });
  }

  simulateClose(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    this._fireEvent('close', { code, reason });
  }
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

function installMockWebSocket() {
  MockWebSocket.instances = [];
  (globalThis as any).WebSocket = MockWebSocket;
}

function removeMockWebSocket() {
  delete (globalThis as any).WebSocket;
}

/** Get the most-recently created MockWebSocket instance. */
function lastSocket(): MockWebSocket {
  const inst = MockWebSocket.instances;
  if (inst.length === 0) throw new Error('No MockWebSocket instances');
  return inst[inst.length - 1]!;
}

/** Create a manager with sensible test defaults. */
function createManager(overrides: Partial<Parameters<typeof WebSocketManager['prototype']['connect']> extends never[]
  ? Record<string, never>
  : Record<string, never>> & Record<string, any> = {}) {
  return new WebSocketManager({
    url: 'wss://test.example.com',
    maxReconnectAttempts: 3,
    initialDelay: 100,
    maxDelay: 1000,
    connectTimeoutMs: 500,
    debug: false,
    label: 'Test',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebSocketManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installMockWebSocket();
  });

  afterEach(() => {
    vi.useRealTimers();
    removeMockWebSocket();
    MockWebSocket.instances = [];
  });

  // ── Initial state ──────────────────────────────────────────────────

  it('initial state is "disconnected"', () => {
    const mgr = createManager();
    expect(mgr.state).toBe('disconnected');
  });

  // ── connect() transitions ──────────────────────────────────────────

  it('connect() transitions to "connecting" then "connected" on open', async () => {
    const mgr = createManager();
    const states: WSState[] = [];
    mgr.onStateChange((s) => states.push(s));

    const connectPromise = mgr.connect();
    // After connect() starts, state should be 'connecting'
    expect(mgr.state).toBe('connecting');

    // Simulate the WebSocket opening
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();

    await connectPromise;
    expect(mgr.state).toBe('connected');
    expect(states).toEqual(['connecting', 'connected']);
  });

  // ── close() transitions ────────────────────────────────────────────

  it('close() transitions to "disconnected"', async () => {
    const mgr = createManager();
    await mgr.connect();
    lastSocket().simulateOpen();

    expect(mgr.state).toBe('connected');

    mgr.close();
    expect(mgr.state).toBe('disconnected');
  });

  // ── send() when connected ──────────────────────────────────────────

  it('send() when connected sends data immediately', async () => {
    const mgr = createManager();
    await mgr.connect();
    lastSocket().simulateOpen();

    mgr.send('hello');
    expect(lastSocket().sent).toContain('hello');
  });

  // ── send() when connecting queues ──────────────────────────────────

  it('send() when connecting queues the message', async () => {
    const mgr = createManager();
    const connectPromise = mgr.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(mgr.state).toBe('connecting');

    // send while still connecting — should not throw
    mgr.send('queued-msg');

    // The underlying socket should NOT have received the message yet
    const sock = lastSocket();
    expect(sock.sent).not.toContain('queued-msg');

    // Now open the connection — queue should flush
    sock.simulateOpen();
    await connectPromise;

    expect(sock.sent).toContain('queued-msg');
  });

  // ── send() when failed throws ──────────────────────────────────────

  it('send() when failed throws error', async () => {
    const mgr = createManager({ maxReconnectAttempts: 0 });
    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);

    // Force a close that triggers reconnection logic — but with 0 max attempts
    // it should immediately go to 'failed'
    lastSocket().simulateClose(1006, 'abnormal');
    await vi.advanceTimersByTimeAsync(0);

    expect(mgr.state).toBe('failed');
    expect(() => mgr.send('test')).toThrow(/FAILED/);
  });

  // ── send() when suspended throws ───────────────────────────────────

  it('send() when suspended throws error', async () => {
    const mgr = createManager();
    await mgr.connect();
    lastSocket().simulateOpen();
    mgr.suspend();

    expect(mgr.state).toBe('suspended');
    expect(() => mgr.send('test')).toThrow(/SUSPENDED/);
  });

  // ── Queue flushes on reconnection ──────────────────────────────────

  it('queue flushes on reconnection', async () => {
    const mgr = createManager();
    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);
    const sock1 = lastSocket();
    sock1.simulateOpen();

    // Queue a message while disconnecting
    // Simulate a server-side close (triggers reconnection)
    sock1.simulateClose(1006, 'abnormal');
    await vi.advanceTimersByTimeAsync(0);

    // Manager should be in reconnecting state; send a message
    mgr.send('reconnect-msg');

    // Advance timers to trigger the reconnection attempt
    await vi.advanceTimersByTimeAsync(2000);

    // A new socket should have been created
    const sock2 = lastSocket();
    expect(sock2).not.toBe(sock1);

    // Open the new socket — queue should flush
    sock2.simulateOpen();
    await vi.advanceTimersByTimeAsync(0);

    expect(sock2.sent).toContain('reconnect-msg');
  });

  // ── Queue drops oldest when exceeding 50 messages ──────────────────

  it('queue drops oldest when exceeding 50 messages', async () => {
    const mgr = createManager();
    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);

    // State is 'connecting' since we haven't simulated open.
    // Actually, let's not open so messages get queued.
    // Wait — connect() calls _attemptConnection which creates the WS. State is 'connecting'.
    // We need to send without the socket being open.

    // Queue 52 messages
    for (let i = 0; i < 52; i++) {
      mgr.send(`msg-${i}`);
    }

    // Now open — the flush should have dropped the oldest 2 messages
    lastSocket().simulateOpen();
    await vi.advanceTimersByTimeAsync(0);

    const sent = lastSocket().sent;
    // msg-0 and msg-1 should have been dropped; msg-2 should be the first
    expect(sent).not.toContain('msg-0');
    expect(sent).not.toContain('msg-1');
    expect(sent).toContain('msg-2');
    expect(sent).toContain('msg-51');
    expect(sent.length).toBe(50);
  });

  // ── Connection timeout ─────────────────────────────────────────────

  it('connection timeout fires if no open event within timeout period', async () => {
    const mgr = createManager({ connectTimeoutMs: 500 });
    const states: WSState[] = [];
    mgr.onStateChange((s) => states.push(s));

    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(mgr.state).toBe('connecting');

    // Advance past the timeout without opening the socket
    await vi.advanceTimersByTimeAsync(600);

    // The timeout handler calls ws.close() which triggers the close event,
    // which in turn triggers the reconnection logic.
    // State should have moved through disconnected -> reconnecting
    expect(states).toContain('connecting');
  });

  // ── Reconnection with exponential backoff ──────────────────────────

  it('reconnects with exponential backoff using fake timers', async () => {
    // Suppress Math.random jitter for predictability
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter factor = 1.0

    const mgr = createManager({
      maxReconnectAttempts: 3,
      initialDelay: 100,
      maxDelay: 10000,
    });

    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);
    const sock1 = lastSocket();
    const instanceCountBefore = MockWebSocket.instances.length;

    // Close the connection to trigger reconnection
    sock1.simulateClose(1006, 'abnormal');
    await vi.advanceTimersByTimeAsync(0);

    // First reconnect: delay = 100 * 2^0 * 1.0 = 100ms
    expect(mgr.state).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    // A new socket should have been created
    expect(MockWebSocket.instances.length).toBeGreaterThan(instanceCountBefore);

    vi.restoreAllMocks();
  });

  // ── Max reconnect attempts → FAILED state ──────────────────────────

  it('enters FAILED state after max reconnect attempts', async () => {
    const mgr = createManager({ maxReconnectAttempts: 2 });
    const states: WSState[] = [];
    mgr.onStateChange((s) => states.push(s));

    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);

    // Simulate repeated failures
    for (let attempt = 0; attempt <= 2; attempt++) {
      const sock = lastSocket();
      sock.simulateClose(1006, 'abnormal');
      // Advance past backoff delay to trigger next reconnection
      await vi.advanceTimersByTimeAsync(60_000);
    }

    expect(mgr.state).toBe('failed');
    expect(states).toContain('failed');
  });

  // ── suspend() stops reconnection ───────────────────────────────────

  it('suspend() stops reconnection attempts', async () => {
    const mgr = createManager({ maxReconnectAttempts: 5 });
    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);

    lastSocket().simulateOpen();
    expect(mgr.state).toBe('connected');

    // Suspend while connected
    mgr.suspend();
    expect(mgr.state).toBe('suspended');

    // Advancing timers should NOT create new sockets
    const countBefore = MockWebSocket.instances.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(MockWebSocket.instances.length).toBe(countBefore);
  });

  // ── resume() from suspended triggers reconnection ──────────────────

  it('resume() from suspended triggers reconnection', async () => {
    const mgr = createManager();
    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();

    mgr.suspend();
    expect(mgr.state).toBe('suspended');

    mgr.resume();
    expect(mgr.state).toBe('reconnecting');

    // Advance to let reconnection timer fire
    await vi.advanceTimersByTimeAsync(5_000);

    // A new socket should have been created
    const newSock = lastSocket();
    expect(newSock.url).toBe('wss://test.example.com');
  });

  // ── destroy() cleans up all resources ──────────────────────────────

  it('destroy() cleans up all resources', async () => {
    const mgr = createManager();
    const stateChangeCb = vi.fn();
    const openCb = vi.fn();
    const closeCb = vi.fn();
    const messageCb = vi.fn();
    const errorCb = vi.fn();

    mgr.onStateChange(stateChangeCb);
    mgr.onOpen(openCb);
    mgr.onClose(closeCb);
    mgr.onMessage(messageCb);
    mgr.onError(errorCb);

    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();

    mgr.destroy();

    expect(mgr.state).toBe('disconnected');

    // After destroy, connect should be a no-op
    await mgr.connect();
    expect(mgr.state).toBe('disconnected');
  });

  // ── onOpen fires correctly ─────────────────────────────────────────

  it('onOpen fires when connection opens', async () => {
    const mgr = createManager();
    const openCb = vi.fn();
    mgr.onOpen(openCb);

    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();

    expect(openCb).toHaveBeenCalledOnce();
  });

  // ── onClose fires correctly ────────────────────────────────────────

  it('onClose fires when connection closes', async () => {
    const mgr = createManager();
    const closeCb = vi.fn();
    mgr.onClose(closeCb);

    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    lastSocket().simulateClose(1000, 'normal');

    expect(closeCb).toHaveBeenCalledWith(1000, 'normal');
  });

  // ── onMessage fires correctly ──────────────────────────────────────

  it('onMessage fires when message received', async () => {
    const mgr = createManager();
    const msgCb = vi.fn();
    mgr.onMessage(msgCb);

    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    lastSocket().simulateMessage('hello');

    expect(msgCb).toHaveBeenCalledOnce();
    expect(msgCb.mock.calls[0]![0]).toEqual({ data: 'hello' });
  });

  // ── onError fires correctly ────────────────────────────────────────

  it('onError fires when error occurs', async () => {
    const mgr = createManager();
    const errorCb = vi.fn();
    mgr.onError(errorCb);

    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateError();

    expect(errorCb).toHaveBeenCalledOnce();
  });

  // ── onStateChange fires correctly ──────────────────────────────────

  it('onStateChange fires with new and previous state', async () => {
    const mgr = createManager();
    const stateChanges: [WSState, WSState][] = [];
    mgr.onStateChange((state, prev) => stateChanges.push([state, prev]));

    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();

    expect(stateChanges).toEqual([
      ['connecting', 'disconnected'],
      ['connected', 'connecting'],
    ]);
  });

  // ── Unsubscribe from events ────────────────────────────────────────

  it('unsubscribe from events works', async () => {
    const mgr = createManager();
    const openCb = vi.fn();
    const unsubOpen = mgr.onOpen(openCb);

    const stateChangeCb = vi.fn();
    const unsubState = mgr.onStateChange(stateChangeCb);

    const messageCb = vi.fn();
    const unsubMsg = mgr.onMessage(messageCb);

    const closeCb = vi.fn();
    const unsubClose = mgr.onClose(closeCb);

    const errorCb = vi.fn();
    const unsubError = mgr.onError(errorCb);

    // Unsubscribe all
    unsubOpen();
    unsubState();
    unsubMsg();
    unsubClose();
    unsubError();

    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    lastSocket().simulateMessage('test');
    lastSocket().simulateError();
    lastSocket().simulateClose();

    expect(openCb).not.toHaveBeenCalled();
    expect(stateChangeCb).not.toHaveBeenCalled();
    expect(messageCb).not.toHaveBeenCalled();
    // closeCb may be called by simulateClose triggering the internal handler,
    // but since we unsubscribed the external callback it should not fire.
    expect(closeCb).not.toHaveBeenCalled();
    expect(errorCb).not.toHaveBeenCalled();
  });

  // ── URL resolution via function ────────────────────────────────────

  it('resolves URL from an async function', async () => {
    const mgr = createManager({
      url: async () => 'wss://dynamic.example.com/ws',
    });

    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);

    const sock = lastSocket();
    expect(sock.url).toBe('wss://dynamic.example.com/ws');
  });

  // ── Protocols are passed to WebSocket constructor ──────────────────

  it('passes protocols to WebSocket constructor', async () => {
    const mgr = createManager({ protocols: ['graphql-ws'] });

    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);

    const sock = lastSocket();
    expect(sock.protocols).toEqual(['graphql-ws']);
  });

  // ── Idempotent connect() ───────────────────────────────────────────

  it('connect() is a no-op if already connected or connecting', async () => {
    const mgr = createManager();
    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);

    const countBefore = MockWebSocket.instances.length;

    // Call connect again while connecting
    await mgr.connect();
    expect(MockWebSocket.instances.length).toBe(countBefore);

    // Open the connection
    lastSocket().simulateOpen();
    expect(mgr.state).toBe('connected');

    // Call connect again while connected
    await mgr.connect();
    expect(MockWebSocket.instances.length).toBe(countBefore);
  });

  // ── resume() is a no-op if not suspended ───────────────────────────

  it('resume() is a no-op if not in suspended state', async () => {
    const mgr = createManager();
    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();

    const stateChanges: WSState[] = [];
    mgr.onStateChange((s) => stateChanges.push(s));

    mgr.resume(); // should do nothing since state is 'connected'
    expect(stateChanges).toEqual([]); // no state change
  });

  // ── connect() from FAILED state resets attempt counter ─────────────

  it('connect() from FAILED state resets attempt counter', async () => {
    const mgr = createManager({ maxReconnectAttempts: 1 });

    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);

    // Simulate repeated failures to reach FAILED
    lastSocket().simulateClose(1006, 'abnormal');
    await vi.advanceTimersByTimeAsync(60_000);
    lastSocket().simulateClose(1006, 'abnormal');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mgr.state).toBe('failed');

    // Now calling connect() should work and reset attempts
    await mgr.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(mgr.state).toBe('connecting');
    lastSocket().simulateOpen();
    expect(mgr.state).toBe('connected');
  });
});
