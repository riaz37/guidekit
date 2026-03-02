/**
 * Unit tests for ElevenLabsSTT adapter
 *
 * @module @guidekit/core/voice
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ElevenLabsSTT } from './elevenlabs-stt.js';
import type { STTTranscriptEvent } from '../types/index.js';

// ---------------------------------------------------------------------------
// WebSocketManager mock
// ---------------------------------------------------------------------------

/** Captured WebSocket state for each test. */
interface MockWSManager {
  url: string;
  onOpenCb: (() => void) | null;
  onMessageCb: ((event: MessageEvent) => void) | null;
  onCloseCb: ((code: number, reason: string) => void) | null;
  onErrorCb: ((event: Event) => void) | null;
  sentMessages: Array<string | ArrayBuffer>;
  connected: boolean;
  destroyed: boolean;
}

let mockWSManager: MockWSManager;

vi.mock('./websocket-manager.js', () => ({
  WebSocketManager: vi.fn().mockImplementation((opts: { url: string }) => {
    mockWSManager = {
      url: opts.url,
      onOpenCb: null,
      onMessageCb: null,
      onCloseCb: null,
      onErrorCb: null,
      sentMessages: [],
      connected: false,
      destroyed: false,
    };

    return {
      connect: vi.fn().mockImplementation(() => {
        mockWSManager.connected = true;
        // Simulate async open
        Promise.resolve().then(() => {
          mockWSManager.onOpenCb?.();
        });
        return Promise.resolve();
      }),
      send: vi.fn().mockImplementation((data: string | ArrayBuffer) => {
        mockWSManager.sentMessages.push(data);
      }),
      close: vi.fn().mockImplementation(() => {
        mockWSManager.connected = false;
      }),
      destroy: vi.fn().mockImplementation(() => {
        mockWSManager.destroyed = true;
        mockWSManager.connected = false;
      }),
      onOpen: vi.fn().mockImplementation((cb: () => void) => {
        mockWSManager.onOpenCb = cb;
      }),
      onMessage: vi.fn().mockImplementation((cb: (e: MessageEvent) => void) => {
        mockWSManager.onMessageCb = cb;
      }),
      onClose: vi.fn().mockImplementation((cb: (code: number, reason: string) => void) => {
        mockWSManager.onCloseCb = cb;
      }),
      onError: vi.fn().mockImplementation((cb: (e: Event) => void) => {
        mockWSManager.onErrorCb = cb;
      }),
    };
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate an ElevenLabs transcript message. */
function emitMessage(type: string, text: string, confidence: number): void {
  const event = new MessageEvent('message', {
    data: JSON.stringify({ type, result: { text, confidence } }),
  });
  mockWSManager.onMessageCb?.(event);
}

/** Parse the last sent JSON message. */
function lastSentJSON(): Record<string, unknown> {
  const last = mockWSManager.sentMessages.at(-1);
  if (typeof last !== 'string') throw new Error('Expected string message');
  return JSON.parse(last) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ElevenLabsSTT', () => {
  let stt: ElevenLabsSTT;

  beforeEach(() => {
    stt = new ElevenLabsSTT({ apiKey: 'test-key', language: 'en' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // connect()
  // -------------------------------------------------------------------------

  describe('connect()', () => {
    it('builds correct URL with xi_api_key, language, and inactivity_timeout', async () => {
      await stt.connect();
      expect(mockWSManager.url).toContain('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
      expect(mockWSManager.url).toContain('xi_api_key=test-key');
      expect(mockWSManager.url).toContain('language=en');
      expect(mockWSManager.url).toContain('inactivity_timeout=30');
    });

    it('sets isConnected to true after connection', async () => {
      await stt.connect();
      // Wait for the async onOpen callback
      await Promise.resolve();
      expect(stt.isConnected).toBe(true);
    });

    it('does not reconnect if already connected', async () => {
      await stt.connect();
      await Promise.resolve();
      const { WebSocketManager } = await import('./websocket-manager.js');
      const callsBefore = (WebSocketManager as ReturnType<typeof vi.fn>).mock.calls.length;
      await stt.connect();
      expect((WebSocketManager as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
    });
  });

  // -------------------------------------------------------------------------
  // sendAudio()
  // -------------------------------------------------------------------------

  describe('sendAudio()', () => {
    beforeEach(async () => {
      await stt.connect();
      await Promise.resolve(); // trigger onOpen
    });

    it('converts Float32Array to Int16, encodes as base64, sends JSON message', () => {
      const float32 = new Float32Array([0.5, -0.5, 0.0]);
      stt.sendAudio(float32);

      const msg = lastSentJSON();
      expect(msg.type).toBe('input_audio_chunk');
      expect(typeof msg.audio).toBe('string');
      expect(msg.sample_rate).toBe(16000);
      // Verify base64 is valid by decoding it
      const decoded = atob(msg.audio as string);
      expect(decoded.length).toBeGreaterThan(0);
    });

    it('encodes Int16Array as base64 without Float32 conversion', () => {
      const int16 = new Int16Array([1000, -1000, 0]);
      stt.sendAudio(int16);

      const msg = lastSentJSON();
      expect(msg.type).toBe('input_audio_chunk');
      expect(typeof msg.audio).toBe('string');
      expect(msg.sample_rate).toBe(16000);
    });

    it('drops audio when suspended', () => {
      stt.suspend();
      const countBefore = mockWSManager.sentMessages.length;
      stt.sendAudio(new Float32Array([0.1, 0.2]));
      expect(mockWSManager.sentMessages.length).toBe(countBefore);
    });

    it('drops audio when not connected', () => {
      const disconnectedSTT = new ElevenLabsSTT({ apiKey: 'test-key' });
      const float32 = new Float32Array([0.1]);
      // Should not throw, simply no-op
      expect(() => disconnectedSTT.sendAudio(float32)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // handleMessage() via onTranscript
  // -------------------------------------------------------------------------

  describe('handleMessage — transcript events', () => {
    beforeEach(async () => {
      await stt.connect();
      await Promise.resolve();
    });

    it('committed_transcript → isFinal: true', () => {
      const events: STTTranscriptEvent[] = [];
      stt.onTranscript((e) => events.push(e));

      emitMessage('committed_transcript', 'Hello world', 0.95);

      expect(events).toHaveLength(1);
      expect(events[0]!.isFinal).toBe(true);
      expect(events[0]!.text).toBe('Hello world');
      expect(events[0]!.confidence).toBe(0.95);
    });

    it('partial_transcript → isFinal: false', () => {
      const events: STTTranscriptEvent[] = [];
      stt.onTranscript((e) => events.push(e));

      emitMessage('partial_transcript', 'Hello', 0.72);

      expect(events).toHaveLength(1);
      expect(events[0]!.isFinal).toBe(false);
      expect(events[0]!.text).toBe('Hello');
    });

    it('skips empty transcript text', () => {
      const events: STTTranscriptEvent[] = [];
      stt.onTranscript((e) => events.push(e));

      emitMessage('committed_transcript', '', 1.0);
      emitMessage('committed_transcript', '   ', 1.0);

      expect(events).toHaveLength(0);
    });

    it('ignores unknown message types', () => {
      const events: STTTranscriptEvent[] = [];
      stt.onTranscript((e) => events.push(e));

      const event = new MessageEvent('message', {
        data: JSON.stringify({ type: 'ping' }),
      });
      mockWSManager.onMessageCb?.(event);

      expect(events).toHaveLength(0);
    });

    it('ignores non-string (binary) messages', () => {
      const events: STTTranscriptEvent[] = [];
      stt.onTranscript((e) => events.push(e));

      const event = new MessageEvent('message', {
        data: new ArrayBuffer(8),
      });
      mockWSManager.onMessageCb?.(event);

      expect(events).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // close()
  // -------------------------------------------------------------------------

  describe('close()', () => {
    it('sends commit_audio before closing', async () => {
      await stt.connect();
      await Promise.resolve();

      stt.close();

      const msgs = mockWSManager.sentMessages.map((m) => {
        if (typeof m === 'string') return JSON.parse(m) as Record<string, unknown>;
        return null;
      });
      const commitMsg = msgs.find((m) => m?.type === 'commit_audio');
      expect(commitMsg).toBeDefined();
    });

    it('is a no-op when not connected', () => {
      // Should not throw
      expect(() => stt.close()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // destroy()
  // -------------------------------------------------------------------------

  describe('destroy()', () => {
    it('clears all callbacks and destroys wsManager', async () => {
      await stt.connect();
      await Promise.resolve();

      const events: STTTranscriptEvent[] = [];
      stt.onTranscript((e) => events.push(e));

      stt.destroy();

      // After destroy, transcript callbacks should be cleared
      emitMessage('committed_transcript', 'Should be ignored', 1.0);
      expect(events).toHaveLength(0);
      expect(mockWSManager.destroyed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // suspend() / resume()
  // -------------------------------------------------------------------------

  describe('suspend() / resume()', () => {
    beforeEach(async () => {
      await stt.connect();
      await Promise.resolve();
    });

    it('suspend() prevents sendAudio from sending', () => {
      stt.suspend();
      const countBefore = mockWSManager.sentMessages.length;
      stt.sendAudio(new Float32Array([0.5]));
      expect(mockWSManager.sentMessages.length).toBe(countBefore);
    });

    it('resume() re-enables sendAudio', () => {
      stt.suspend();
      stt.resume();
      const countBefore = mockWSManager.sentMessages.length;
      stt.sendAudio(new Float32Array([0.5]));
      expect(mockWSManager.sentMessages.length).toBe(countBefore + 1);
    });

    it('suspend() is idempotent', () => {
      stt.suspend();
      stt.suspend(); // Should not throw
      expect(stt.isConnected).toBe(true);
    });

    it('resume() is idempotent when not suspended', () => {
      stt.resume(); // Should not throw
    });
  });

  // -------------------------------------------------------------------------
  // onTranscript()
  // -------------------------------------------------------------------------

  describe('onTranscript()', () => {
    beforeEach(async () => {
      await stt.connect();
      await Promise.resolve();
    });

    it('returns unsubscribe function that removes the callback', () => {
      const events: STTTranscriptEvent[] = [];
      const unsub = stt.onTranscript((e) => events.push(e));

      emitMessage('committed_transcript', 'Before unsub', 0.9);
      expect(events).toHaveLength(1);

      unsub();
      emitMessage('committed_transcript', 'After unsub', 0.9);
      expect(events).toHaveLength(1); // Not incremented
    });

    it('calling unsubscribe twice is safe', () => {
      const unsub = stt.onTranscript(() => {});
      unsub();
      expect(() => unsub()).not.toThrow();
    });

    it('notifies all registered callbacks', () => {
      const eventsA: STTTranscriptEvent[] = [];
      const eventsB: STTTranscriptEvent[] = [];
      stt.onTranscript((e) => eventsA.push(e));
      stt.onTranscript((e) => eventsB.push(e));

      emitMessage('committed_transcript', 'Hello', 0.95);

      expect(eventsA).toHaveLength(1);
      expect(eventsB).toHaveLength(1);
    });
  });
});
