// ---------------------------------------------------------------------------
// ElevenLabsTTS – Unit Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ElevenLabsTTS } from './elevenlabs-tts.js';

// ---------------------------------------------------------------------------
// Mock WebSocket
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

describe('ElevenLabsTTS', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installMockWS();
    // Mock atob for base64 decoding
    if (typeof globalThis.atob === 'undefined') {
      (globalThis as any).atob = (str: string) => Buffer.from(str, 'base64').toString('binary');
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    removeMockWS();
    MockWebSocket.instances = [];
  });

  function createTTS(overrides: Partial<ConstructorParameters<typeof ElevenLabsTTS>[0]> = {}) {
    return new ElevenLabsTTS({
      apiKey: 'test-api-key',
      ...overrides,
    });
  }

  // ── connect() ───────────────────────────────────────────────────────

  it('connect() opens a WebSocket to ElevenLabs', async () => {
    const tts = createTTS();
    const p = tts.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    expect(tts.isConnected).toBe(true);
    expect(lastSocket().url).toContain('api.elevenlabs.io');
  });

  it('connect() sends BOS handshake on open', async () => {
    const tts = createTTS();
    const p = tts.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    // The BOS message should have been sent via the WebSocketManager
    // which sends to the underlying socket
    const sock = lastSocket();
    const bosMessages = sock.sent.filter((msg) => {
      if (typeof msg !== 'string') return false;
      const parsed = JSON.parse(msg);
      return parsed.xi_api_key !== undefined;
    });
    expect(bosMessages.length).toBe(1);
  });

  it('connect() is idempotent', async () => {
    const tts = createTTS();
    const p = tts.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    const countBefore = MockWebSocket.instances.length;
    await tts.connect();
    expect(MockWebSocket.instances.length).toBe(countBefore);
  });

  it('buildUrl includes voice ID and model', async () => {
    const tts = createTTS({ voiceId: 'custom-voice', modelId: 'eleven_turbo_v2' });
    const p = tts.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    expect(lastSocket().url).toContain('custom-voice');
    expect(lastSocket().url).toContain('model_id=eleven_turbo_v2');
  });

  // ── speak() ─────────────────────────────────────────────────────────

  it('speak() sends text chunk via WebSocket', async () => {
    const tts = createTTS();
    const p = tts.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    tts.speak('Hello world');

    const textMessages = lastSocket().sent.filter((msg) => {
      if (typeof msg !== 'string') return false;
      const parsed = JSON.parse(msg);
      return parsed.text === 'Hello world';
    });
    expect(textMessages.length).toBe(1);
  });

  it('speak() does nothing when not connected', () => {
    const tts = createTTS();
    tts.speak('Hello'); // should not throw
  });

  it('speak() does nothing with empty text', async () => {
    const tts = createTTS();
    const p = tts.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    const sentBefore = lastSocket().sent.length;
    tts.speak('');
    expect(lastSocket().sent.length).toBe(sentBefore);
  });

  // ── flush() ─────────────────────────────────────────────────────────

  it('flush() sends EOS marker', async () => {
    const tts = createTTS();
    const p = tts.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    tts.flush();

    const eosMessages = lastSocket().sent.filter((msg) => {
      if (typeof msg !== 'string') return false;
      const parsed = JSON.parse(msg);
      return parsed.text === '';
    });
    expect(eosMessages.length).toBe(1);
  });

  it('flush() does nothing when not connected', () => {
    const tts = createTTS();
    tts.flush(); // should not throw
  });

  // ── onAudio() ───────────────────────────────────────────────────────

  it('emits audio events from incoming messages', async () => {
    const tts = createTTS();
    const cb = vi.fn();
    tts.onAudio(cb);

    const p = tts.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    // Simulate an audio message (base64 encoded)
    const audioBase64 = btoa('fake audio data');
    lastSocket().simulateMessage(JSON.stringify({
      audio: audioBase64,
      isFinal: false,
    }));

    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ isFinal: false }),
    );
    expect(cb.mock.calls[0][0].audio.byteLength).toBeGreaterThan(0);
  });

  it('emits final event when isFinal is true', async () => {
    const tts = createTTS();
    const cb = vi.fn();
    tts.onAudio(cb);

    const p = tts.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    lastSocket().simulateMessage(JSON.stringify({
      audio: '',
      isFinal: true,
    }));

    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ isFinal: true }),
    );
  });

  it('ignores error messages from ElevenLabs', async () => {
    const tts = createTTS();
    const cb = vi.fn();
    tts.onAudio(cb);

    const p = tts.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    lastSocket().simulateMessage(JSON.stringify({ error: 'rate_limit' }));
    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores non-audio messages', async () => {
    const tts = createTTS();
    const cb = vi.fn();
    tts.onAudio(cb);

    const p = tts.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    lastSocket().simulateMessage(JSON.stringify({ alignment: {} }));
    expect(cb).not.toHaveBeenCalled();
  });

  it('unsubscribe from onAudio works', async () => {
    const tts = createTTS();
    const cb = vi.fn();
    const unsub = tts.onAudio(cb);
    unsub();

    const p = tts.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    lastSocket().simulateMessage(JSON.stringify({
      audio: btoa('data'),
      isFinal: false,
    }));
    expect(cb).not.toHaveBeenCalled();
  });

  // ── close() ─────────────────────────────────────────────────────────

  it('close() sends EOS and closes WebSocket', async () => {
    const tts = createTTS();
    const p = tts.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    tts.close();
    expect(tts.isConnected).toBe(false);
  });

  it('close() is safe when not connected', () => {
    const tts = createTTS();
    expect(() => tts.close()).not.toThrow();
  });

  // ── destroy() ───────────────────────────────────────────────────────

  it('destroy() cleans up everything', async () => {
    const tts = createTTS();
    const p = tts.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    tts.destroy();
    expect(tts.isConnected).toBe(false);
  });

  // ── suspend() / resume() ────────────────────────────────────────────

  it('suspend() prevents speak and flush', async () => {
    const tts = createTTS();
    const p = tts.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    tts.suspend();
    const sentBefore = lastSocket().sent.length;
    tts.speak('test');
    tts.flush();
    expect(lastSocket().sent.length).toBe(sentBefore);
  });

  it('resume() re-enables speak', async () => {
    const tts = createTTS();
    const p = tts.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    tts.suspend();
    tts.resume();
    tts.speak('after resume');

    const textMessages = lastSocket().sent.filter((msg) => {
      if (typeof msg !== 'string') return false;
      // All sent messages should be valid JSON — parse without swallowing errors
      const parsed = JSON.parse(msg);
      return parsed.text === 'after resume';
    });
    expect(textMessages.length).toBe(1);
  });

  it('suspend is idempotent', async () => {
    const tts = createTTS();
    const p = tts.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    tts.suspend();
    tts.suspend(); // should not throw
  });

  it('resume is a no-op when not suspended', async () => {
    const tts = createTTS();
    const p = tts.connect();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().simulateOpen();
    await p;

    tts.resume(); // should not throw
  });
});
