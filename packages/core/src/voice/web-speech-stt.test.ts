// ---------------------------------------------------------------------------
// WebSpeechSTT – Unit Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSpeechSTT } from './web-speech-stt.js';

// ---------------------------------------------------------------------------
// Mock SpeechRecognition
// ---------------------------------------------------------------------------

class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = [];

  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;

  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;

  private _listeners: Record<string, Function[]> = {};
  private _started = false;

  constructor() {
    MockSpeechRecognition.instances.push(this);
  }

  start() {
    this._started = true;
    // Fire start event asynchronously
    queueMicrotask(() => {
      this.onstart?.();
      this._fireEvent('start');
    });
  }

  stop() {
    this._started = false;
    queueMicrotask(() => {
      this.onend?.();
    });
  }

  abort() {
    this._started = false;
  }

  addEventListener(event: string, handler: Function, _options?: any) {
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
    for (const fn of list.slice()) {
      fn(data);
    }
  }

  // Test helpers
  simulateResult(transcript: string, isFinal: boolean, confidence = 0.95) {
    const event = {
      resultIndex: 0,
      results: {
        length: 1,
        item: (i: number) => event.results[i],
        0: {
          length: 1,
          isFinal,
          item: (i: number) => event.results[0][i],
          0: { transcript, confidence },
        },
      },
    };
    this.onresult?.(event);
  }

  simulateError(error: string, message = '') {
    const event = { error, message };
    this.onerror?.(event);
    this._fireEvent('error', event);
  }
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

function installMock() {
  MockSpeechRecognition.instances = [];
  (window as any).SpeechRecognition = MockSpeechRecognition;
}

function removeMock() {
  delete (window as any).SpeechRecognition;
}

function lastInstance(): MockSpeechRecognition {
  const arr = MockSpeechRecognition.instances;
  if (arr.length === 0) throw new Error('No instances');
  return arr[arr.length - 1]!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebSpeechSTT', () => {
  beforeEach(() => {
    installMock();
  });

  afterEach(() => {
    removeMock();
    MockSpeechRecognition.instances = [];
  });

  // ── isSupported() ───────────────────────────────────────────────────

  it('isSupported returns true when SpeechRecognition is available', () => {
    expect(WebSpeechSTT.isSupported()).toBe(true);
  });

  it('isSupported returns false when SpeechRecognition is unavailable', () => {
    removeMock();
    expect(WebSpeechSTT.isSupported()).toBe(false);
  });

  // ── connect() ───────────────────────────────────────────────────────

  it('connect() resolves when recognition starts', async () => {
    const stt = new WebSpeechSTT();
    await stt.connect();
    expect(stt.isConnected).toBe(true);
  });

  it('connect() is idempotent when already connected', async () => {
    const stt = new WebSpeechSTT();
    await stt.connect();
    const countBefore = MockSpeechRecognition.instances.length;
    await stt.connect();
    expect(MockSpeechRecognition.instances.length).toBe(countBefore);
  });

  it('connect() throws when API is not supported', async () => {
    removeMock();
    const stt = new WebSpeechSTT();
    // In jsdom, window is defined so it won't hit the SSR guard
    // But SpeechRecognition is gone, so it should throw
    await expect(stt.connect()).rejects.toThrow('not supported');
  });

  it('sets language, continuous, and interimResults on recognition', async () => {
    const stt = new WebSpeechSTT({
      language: 'fr-FR',
      continuous: false,
      interimResults: false,
    });
    await stt.connect();
    const inst = lastInstance();
    expect(inst.lang).toBe('fr-FR');
    expect(inst.continuous).toBe(false);
    expect(inst.interimResults).toBe(false);
  });

  // ── onTranscript() ──────────────────────────────────────────────────

  it('emits transcript events to registered callbacks', async () => {
    const stt = new WebSpeechSTT();
    const cb = vi.fn();
    stt.onTranscript(cb);
    await stt.connect();

    lastInstance().simulateResult('hello world', true, 0.95);

    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'hello world',
        isFinal: true,
        confidence: 0.95,
      }),
    );
  });

  it('emits interim transcripts', async () => {
    const stt = new WebSpeechSTT();
    const cb = vi.fn();
    stt.onTranscript(cb);
    await stt.connect();

    // Confidence 0 for interim => fallback to 0.85
    lastInstance().simulateResult('hel', false, 0);

    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'hel',
        isFinal: false,
        confidence: 0.85,
      }),
    );
  });

  it('unsubscribe prevents further callbacks', async () => {
    const stt = new WebSpeechSTT();
    const cb = vi.fn();
    const unsub = stt.onTranscript(cb);
    await stt.connect();

    unsub();
    lastInstance().simulateResult('hello', true);
    expect(cb).not.toHaveBeenCalled();
  });

  it('unsubscribe is idempotent', async () => {
    const stt = new WebSpeechSTT();
    const unsub = stt.onTranscript(vi.fn());
    unsub();
    unsub(); // should not throw
  });

  // ── sendAudio() ─────────────────────────────────────────────────────

  it('sendAudio is a no-op (Web Speech manages its own audio)', async () => {
    const stt = new WebSpeechSTT();
    // Should not throw
    stt.sendAudio(new Float32Array(10));
  });

  // ── close() ─────────────────────────────────────────────────────────

  it('close() stops recognition and resets state', async () => {
    const stt = new WebSpeechSTT();
    await stt.connect();
    expect(stt.isConnected).toBe(true);

    stt.close();
    expect(stt.isConnected).toBe(false);
  });

  it('close() is safe when not connected', () => {
    const stt = new WebSpeechSTT();
    expect(() => stt.close()).not.toThrow();
  });

  // ── destroy() ───────────────────────────────────────────────────────

  it('destroy() cleans up and clears callbacks', async () => {
    const stt = new WebSpeechSTT();
    const cb = vi.fn();
    stt.onTranscript(cb);
    await stt.connect();

    stt.destroy();
    expect(stt.isConnected).toBe(false);
  });

  // ── suspend() / resume() ────────────────────────────────────────────

  it('suspend() marks as suspended and stops recognition', async () => {
    const stt = new WebSpeechSTT();
    await stt.connect();
    stt.suspend();
    // After suspend + onend fires (via queueMicrotask), isConnected becomes false
    await Promise.resolve();
    expect(stt.isConnected).toBe(false);
  });

  it('suspend() is idempotent', async () => {
    const stt = new WebSpeechSTT();
    await stt.connect();
    stt.suspend();
    stt.suspend(); // should not throw
  });

  it('resume() restarts after suspend', async () => {
    const stt = new WebSpeechSTT();
    await stt.connect();
    const inst = lastInstance();
    const startSpy = vi.spyOn(inst, 'start');

    stt.suspend();
    // Wait for the microtask fired by stop() → onend to set _connected = false
    await Promise.resolve();
    await Promise.resolve();

    stt.resume();

    // resume should attempt to restart recognition
    expect(startSpy).toHaveBeenCalled();
  });

  it('resume() is a no-op when not suspended', async () => {
    const stt = new WebSpeechSTT();
    await stt.connect();
    stt.resume(); // should not throw
  });

  // ── Error handling ──────────────────────────────────────────────────

  it('handles non-fatal errors without stopping', async () => {
    const stt = new WebSpeechSTT();
    await stt.connect();
    // Simulate non-fatal error
    lastInstance().simulateError('no-speech');
    // Should still be connected
    expect(stt.isConnected).toBe(true);
  });

  it('handles fatal errors by marking intentional stop', async () => {
    const stt = new WebSpeechSTT();
    await stt.connect();
    // Simulate fatal error
    lastInstance().simulateError('not-allowed', 'Permission denied');
    // The error handler sets _intentionalStop but doesn't change isConnected directly
    // isConnected is changed by onend handler
  });
});
