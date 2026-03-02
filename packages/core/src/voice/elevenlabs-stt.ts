// ---------------------------------------------------------------------------
// GuideKit SDK – ElevenLabs Real-Time Speech-to-Text Adapter
// ---------------------------------------------------------------------------
//
// Streams microphone audio to ElevenLabs over a WebSocket using JSON messages
// with base64-encoded PCM audio. Emits interim / final transcript events.
//
// Protocol:
//   - Send: { type: 'input_audio_chunk', audio: <base64>, sample_rate: 16000 }
//   - Receive: { type: 'partial_transcript', result: { text, confidence } }
//              { type: 'committed_transcript', result: { text, confidence } }
//   - Close: send { type: 'commit_audio' } before closing socket
// ---------------------------------------------------------------------------

import { WebSocketManager } from './websocket-manager.js';
import type { STTTranscriptEvent } from '../types/index.js';

// Re-export the shared type for consumers that only import from this module
export type { STTTranscriptEvent };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[GuideKit:ElevenLabs-STT]';

const ELEVENLABS_STT_ENDPOINT =
  'wss://api.elevenlabs.io/v1/speech-to-text/realtime';

const DEFAULT_LANGUAGE = 'en';
const INACTIVITY_TIMEOUT_S = 30;
const SAMPLE_RATE = 16_000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ElevenLabsSTTOptions {
  apiKey: string;
  language?: string;
  debug?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert Float32Array PCM samples (range -1..1) to Int16Array (linear16).
 */
function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]!));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

/**
 * Encode an Int16Array as a base64 string.
 * Uses chunked encoding to avoid stack overflow on large buffers.
 */
function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer);
  // Replace character-by-character loop with chunked encoding
  const CHUNK_SIZE = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// ElevenLabsSTT
// ---------------------------------------------------------------------------

export class ElevenLabsSTT {
  // ---- Configuration -------------------------------------------------------

  private readonly apiKey: string;
  private readonly language: string;
  private readonly debugEnabled: boolean;

  // ---- Internal state ------------------------------------------------------

  private wsManager: WebSocketManager | null = null;
  private _connected = false;
  private _suspended = false;

  /** Registered transcript callbacks. */
  private readonly transcriptCallbacks: Set<(event: STTTranscriptEvent) => void> =
    new Set();

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  constructor(options: ElevenLabsSTTOptions) {
    this.apiKey = options.apiKey;
    this.language = options.language ?? DEFAULT_LANGUAGE;
    this.debugEnabled = options.debug ?? false;

    this.log('ElevenLabsSTT created', { language: this.language });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Whether the WebSocket is currently connected and ready. */
  get isConnected(): boolean {
    return this._connected;
  }

  /**
   * Open a WebSocket connection to ElevenLabs' real-time STT endpoint.
   *
   * Resolves once the connection is established and the socket is ready to
   * receive audio frames. Rejects if the connection cannot be established.
   */
  async connect(): Promise<void> {
    if (this._connected) {
      this.log('Already connected — skipping');
      return;
    }

    if (typeof WebSocket === 'undefined') {
      this.log('WebSocket API not available (SSR?) — cannot connect');
      return;
    }

    const url = this.buildUrl();
    this.log('Connecting to', url.replace(this.apiKey, '***'));

    this.wsManager = new WebSocketManager({
      url,
      protocols: [],
      debug: this.debugEnabled,
      label: 'ElevenLabs-STT',
    });

    this.wsManager.onOpen(() => {
      this._connected = true;
      this.log('Connected');
    });
    this.wsManager.onMessage((event: MessageEvent) => {
      this.handleMessage(event);
    });
    this.wsManager.onClose((code: number, reason: string) => {
      this.log('Connection closed', { code, reason });
      this.cleanup();
    });
    this.wsManager.onError((event: Event) => {
      this.log('WebSocket error', event);
    });

    return this.wsManager.connect();
  }

  /**
   * Send audio data to ElevenLabs for transcription.
   *
   * Accepts either `Float32Array` (Web Audio API output) or `Int16Array`
   * (already encoded as linear16). Float32 data is automatically converted
   * to Int16 before encoding. Audio is sent as a base64-encoded JSON message.
   */
  sendAudio(audioData: Float32Array | Int16Array): void {
    if (!this._connected || !this.wsManager || this._suspended) {
      return;
    }

    const int16 =
      audioData instanceof Float32Array ? float32ToInt16(audioData) : audioData;

    const base64 = int16ToBase64(int16);

    this.wsManager.send(
      JSON.stringify({
        type: 'input_audio_chunk',
        audio: base64,
        sample_rate: SAMPLE_RATE,
      }),
    );
  }

  /**
   * Register a callback to receive transcript events.
   *
   * @returns An unsubscribe function. Calling it more than once is safe.
   */
  onTranscript(callback: (event: STTTranscriptEvent) => void): () => void {
    this.transcriptCallbacks.add(callback);

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.transcriptCallbacks.delete(callback);
    };
  }

  /**
   * Gracefully close the connection.
   *
   * Sends a `commit_audio` message so ElevenLabs can finalise any pending
   * transcription before the socket is torn down.
   */
  close(): void {
    if (!this._connected || !this.wsManager) {
      this.log('Not connected — nothing to close');
      return;
    }

    this.log('Sending commit_audio and closing');

    try {
      this.wsManager.send(JSON.stringify({ type: 'commit_audio' }));
    } catch {
      // Socket may already be closing — ignore.
    }

    this.wsManager.close();
    this.cleanup();
  }

  /** Force-destroy the connection without a graceful handshake. */
  destroy(): void {
    this.log('Destroying');

    if (this.wsManager) {
      this.wsManager.destroy();
      this.wsManager = null;
    }

    this.cleanup();
    this.transcriptCallbacks.clear();
  }

  /**
   * Suspend the adapter (e.g. when the device goes offline).
   *
   * Marks the adapter as suspended so that incoming `sendAudio` calls are
   * silently dropped. The WebSocket itself is left open.
   */
  suspend(): void {
    if (this._suspended) return;

    this._suspended = true;
    this.log('Suspended');
  }

  /**
   * Resume after a prior `suspend()`.
   */
  resume(): void {
    if (!this._suspended) return;

    this._suspended = false;
    this.log('Resumed');
  }

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------

  /**
   * Parse incoming ElevenLabs JSON messages and emit transcript events.
   *
   * ElevenLabs sends two transcript message types:
   * - `partial_transcript`: interim result, `isFinal = false`
   * - `committed_transcript`: final result, `isFinal = true`
   */
  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') {
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(event.data) as Record<string, unknown>;
    } catch {
      this.log('Failed to parse message', event.data);
      return;
    }

    const type = parsed['type'] as string | undefined;

    if (type === 'committed_transcript' || type === 'partial_transcript') {
      this.handleTranscriptMessage(parsed, type === 'committed_transcript');
    } else {
      this.log('Received message', type, parsed);
    }
  }

  /**
   * Extract transcript data from a transcript message and notify subscribers.
   */
  private handleTranscriptMessage(
    parsed: Record<string, unknown>,
    isFinal: boolean,
  ): void {
    const result = parsed['result'] as
      | { text?: string; confidence?: number }
      | undefined;

    const text = result?.text ?? '';
    const confidence = result?.confidence ?? 0;

    if (text.trim() === '') {
      return;
    }

    const transcriptEvent: STTTranscriptEvent = {
      text,
      isFinal,
      confidence,
      timestamp: Date.now(),
    };

    this.log(
      isFinal ? 'Final transcript:' : 'Interim transcript:',
      text,
      `(${(confidence * 100).toFixed(1)}%)`,
    );

    this.emitTranscript(transcriptEvent);
  }

  // -------------------------------------------------------------------------
  // Subscriber notification
  // -------------------------------------------------------------------------

  /**
   * Emit a transcript event to all registered callbacks.
   *
   * Errors thrown by individual callbacks are caught and logged so one
   * misbehaving subscriber does not prevent others from receiving the event.
   */
  private emitTranscript(event: STTTranscriptEvent): void {
    for (const cb of this.transcriptCallbacks) {
      try {
        cb(event);
      } catch (err) {
        console.error(LOG_PREFIX, 'Transcript callback threw:', err);
      }
    }
  }

  // -------------------------------------------------------------------------
  // URL building
  // -------------------------------------------------------------------------

  /** Build the ElevenLabs streaming STT endpoint URL with auth query params. */
  private buildUrl(): string {
    const params = new URLSearchParams({
      xi_api_key: this.apiKey,
      language: this.language,
      inactivity_timeout: String(INACTIVITY_TIMEOUT_S),
    });

    return `${ELEVENLABS_STT_ENDPOINT}?${params.toString()}`;
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /** Reset internal state after disconnection. */
  private cleanup(): void {
    this._connected = false;
  }

  // -------------------------------------------------------------------------
  // Logging
  // -------------------------------------------------------------------------

  /** Conditional debug logging. */
  private log(...args: unknown[]): void {
    if (this.debugEnabled) {
      console.debug(LOG_PREFIX, ...args);
    }
  }
}
