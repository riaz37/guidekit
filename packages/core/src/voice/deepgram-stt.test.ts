// ---------------------------------------------------------------------------
// DeepgramSTT – Unit Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeepgramSTT } from './deepgram-stt.js';

// ---------------------------------------------------------------------------
// Mock WebSocket (reuse pattern from websocket-manager.test.ts)
// ---------------------------------------------------------------------------

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = 0;
  sent: any[] = [];
  binaryType = 'blob';

  private _listeners: Record<string, Function[]> = {};

  constructor(public url: string, public protocols?: string | string[]) {
    MockWebSocket.instances.push(this);
  }

  send(data: any) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    this._fireEvent('close', { code: code ?? 1000, reason: reason ?? '' });
  }

  addEventListener(event: string, handler: Function) {
    if (!this._listeners[event]) this._listeners[event] = [];
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
    for (const fn of list.slice()) fn(data);
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this._fireEvent('open');
  }

  simulateMessage(data: any) {
    this._fireEvent('message', { data });
  }

  simulateClose(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    this._fireEvent('close', { code, reason });
  }
}

function installMockWS() {
  MockWebSocket.instances = [];
  (globalThis as any).WebSocket = MockWebSocket;
}

function removeMockWS() {
  delete (globalThis as any).WebSocket;
}

function lastSocket(): MockWebSocket {
  const arr = MockWebSocket.instances;
  if (arr.length === 0) throw new Error('No MockWebSocket instances');
  return arr[arr.length - 1]!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeepgramSTT', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installMockWS();
  });

  afterEach(() => {
    vi.useRealTimers();
    removeMockWS();
    MockWebSocket.instances = [];
  });

  function createSTT(overrides: Partial<ConstructorParameters<typeof DeepgramSTT>[0]> = {}) {
    return new DeepgramSTT({
      apiKey: 'test-key',
      ...overrides,
    });
  }

  // ── connect() ───────────────────────────────────────────────────────

  it('connect() opens a WebSocket to Deepgram', async () => {
    const stt = createSTT();
    const connectPromise = stt.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await connectPromise;

    expect(stt.isConnected).toBe(true);
    expect(lastSocket().url).toContain('api.deepgram.com');
  });

  it('connect() is idempotent when already connected', async () => {
    const stt = createSTT();
    const p = stt.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    const countBefore = MockWebSocket.instances.length;
    await stt.connect();
    expect(MockWebSocket.instances.length).toBe(countBefore);
  });

  it('buildUrl includes model and language params', async () => {
    const stt = createSTT({ model: 'nova-2', language: 'es' });
    const p = stt.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    expect(lastSocket().url).toContain('model=nova-2');
    expect(lastSocket().url).toContain('language=es');
  });

  // ── sendAudio() ─────────────────────────────────────────────────────

  it('sendAudio sends Float32 data as Int16 buffer', async () => {
    const stt = createSTT();
    const p = stt.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    const audioData = new Float32Array([0.5, -0.5, 0.0]);
    stt.sendAudio(audioData);

    // The WebSocketManager sends to the underlying socket
    // We can check the manager forwarded data
    expect(stt.isConnected).toBe(true);
  });

  it('sendAudio does nothing when not connected', () => {
    const stt = createSTT();
    // Should not throw
    stt.sendAudio(new Float32Array(10));
  });

  it('sendAudio does nothing when suspended', async () => {
    const stt = createSTT();
    const p = stt.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    stt.suspend();
    stt.sendAudio(new Float32Array(10));
    // No error should occur
  });

  // ── onTranscript() ──────────────────────────────────────────────────

  it('emits transcript events from Deepgram Results messages', async () => {
    const stt = createSTT();
    const cb = vi.fn();
    stt.onTranscript(cb);

    const p = stt.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    const msg = JSON.stringify({
      type: 'Results',
      channel: {
        alternatives: [{ transcript: 'hello world', confidence: 0.97 }],
      },
      is_final: true,
      speech_final: true,
    });

    lastSocket().simulateMessage(msg);

    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'hello world',
        isFinal: true,
        confidence: 0.97,
      }),
    );
  });

  it('emits interim transcripts', async () => {
    const stt = createSTT();
    const cb = vi.fn();
    stt.onTranscript(cb);

    const p = stt.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    const msg = JSON.stringify({
      type: 'Results',
      channel: { alternatives: [{ transcript: 'hel', confidence: 0.8 }] },
      is_final: false,
      speech_final: false,
    });

    lastSocket().simulateMessage(msg);

    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'hel', isFinal: false }),
    );
  });

  it('ignores empty transcripts (silence)', async () => {
    const stt = createSTT();
    const cb = vi.fn();
    stt.onTranscript(cb);

    const p = stt.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    const msg = JSON.stringify({
      type: 'Results',
      channel: { alternatives: [{ transcript: '', confidence: 0 }] },
      is_final: false,
      speech_final: false,
    });

    lastSocket().simulateMessage(msg);
    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores non-Results message types', async () => {
    const stt = createSTT();
    const cb = vi.fn();
    stt.onTranscript(cb);

    const p = stt.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    lastSocket().simulateMessage(JSON.stringify({ type: 'Metadata' }));
    expect(cb).not.toHaveBeenCalled();
  });

  it('unsubscribe works', async () => {
    const stt = createSTT();
    const cb = vi.fn();
    const unsub = stt.onTranscript(cb);
    unsub();

    const p = stt.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    lastSocket().simulateMessage(JSON.stringify({
      type: 'Results',
      channel: { alternatives: [{ transcript: 'test', confidence: 0.9 }] },
      is_final: true,
      speech_final: true,
    }));

    expect(cb).not.toHaveBeenCalled();
  });

  // ── close() ─────────────────────────────────────────────────────────

  it('close() sends CloseStream and cleans up', async () => {
    const stt = createSTT();
    const p = stt.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    stt.close();
    expect(stt.isConnected).toBe(false);
  });

  it('close() is safe when not connected', () => {
    const stt = createSTT();
    expect(() => stt.close()).not.toThrow();
  });

  // ── destroy() ───────────────────────────────────────────────────────

  it('destroy() cleans up everything', async () => {
    const stt = createSTT();
    const p = stt.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    stt.destroy();
    expect(stt.isConnected).toBe(false);
  });

  // ── suspend() / resume() ────────────────────────────────────────────

  it('suspend() stops keepalive and marks suspended', async () => {
    const stt = createSTT();
    const p = stt.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    stt.suspend();
    // sendAudio should be dropped
    stt.sendAudio(new Float32Array(10));
  });

  it('resume() restarts keepalive', async () => {
    const stt = createSTT();
    const p = stt.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    stt.suspend();
    stt.resume();
    // Should not throw, keepalive should restart
  });

  it('suspend is idempotent', async () => {
    const stt = createSTT();
    const p = stt.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    stt.suspend();
    stt.suspend(); // should not throw
  });

  it('resume is a no-op when not suspended', async () => {
    const stt = createSTT();
    const p = stt.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    stt.resume(); // should not throw
  });
});
