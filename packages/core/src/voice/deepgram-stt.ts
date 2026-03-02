// ---------------------------------------------------------------------------
// GuideKit SDK – Deepgram Nova Real-Time Speech-to-Text Adapter
// ---------------------------------------------------------------------------
//
// Streams microphone audio to Deepgram over a WebSocket and emits interim /
// final transcript events. Designed for browser use; all browser-only APIs are
// guarded behind `typeof window` checks so the module is safe to import at
// build time in SSR environments.
// ---------------------------------------------------------------------------

import { WebSocketManager } from './websocket-manager.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[GuideKit:STT]';

/** Interval (ms) between KeepAlive messages sent to Deepgram. */
const KEEPALIVE_INTERVAL_MS = 10_000;

/** Default Deepgram model. */
const DEFAULT_MODEL = 'nova-3';

/** Default language. */
const DEFAULT_LANGUAGE = 'en';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DeepgramSTTOptions {
  apiKey: string;
  model?: 'nova-2' | 'nova-3';
  language?: string;
  debug?: boolean;
}

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  confidence: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert Float32Array PCM samples (range -1..1) to Int16Array (linear16).
 * Deepgram expects linear16 encoded audio frames.
 */
function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    // Clamp to [-1, 1] then scale to Int16 range.
    const s = Math.max(-1, Math.min(1, float32[i]!));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

// ---------------------------------------------------------------------------
// DeepgramSTT
// ---------------------------------------------------------------------------

export class DeepgramSTT {
  // ---- Configuration ------------------------------------------------------

  private readonly apiKey: string;
  private readonly model: 'nova-2' | 'nova-3';
  private readonly language: string;
  private readonly debugEnabled: boolean;

  // ---- Internal state -----------------------------------------------------

  private wsManager: WebSocketManager | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private _connected = false;
  private _suspended = false;

  /** Registered transcript callbacks. */
  private readonly transcriptCallbacks: Set<(event: TranscriptEvent) => void> =
    new Set();

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(options: DeepgramSTTOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.language = options.language ?? DEFAULT_LANGUAGE;
    this.debugEnabled = options.debug ?? false;

    this.log('DeepgramSTT created', {
      model: this.model,
      language: this.language,
    });
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Whether the WebSocket is currently connected and ready. */
  get isConnected(): boolean {
    return this._connected;
  }

  /**
   * Open a WebSocket connection to Deepgram's real-time STT endpoint.
   *
   * Resolves once the connection is established and the socket is ready to
   * receive audio frames. Rejects if the connection cannot be established.
   */
  async connect(): Promise<void> {
    if (this._connected) {
      this.log('Already connected — skipping');
      return;
    }

    // SSR guard
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
      label: 'Deepgram-STT',
    });

    this.wsManager.onOpen(() => {
      this._connected = true;
      this.startKeepAlive();
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
   * Send audio data to Deepgram for transcription.
   *
   * Accepts either `Float32Array` (Web Audio API output) or `Int16Array`
   * (already encoded as linear16). Float32 data is automatically converted
   * to Int16 before sending.
   */
  sendAudio(audioData: Float32Array | Int16Array): void {
    if (!this._connected || !this.wsManager || this._suspended) {
      return;
    }

    let buffer: ArrayBuffer;
    if (audioData instanceof Float32Array) {
      buffer = float32ToInt16(audioData).buffer as ArrayBuffer;
    } else {
      buffer = audioData.buffer as ArrayBuffer;
    }

    this.wsManager.send(buffer);
  }

  /**
   * Register a callback to receive transcript events.
   *
   * @returns An unsubscribe function. Calling it more than once is safe.
   */
  onTranscript(callback: (event: TranscriptEvent) => void): () => void {
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
   * Sends a `CloseStream` message to Deepgram so the server can finalise
   * any pending transcription before the socket is torn down.
   */
  close(): void {
    if (!this._connected || !this.wsManager) {
      this.log('Not connected — nothing to close');
      return;
    }

    this.log('Sending CloseStream and closing');
    this.stopKeepAlive();

    try {
      this.wsManager.send(JSON.stringify({ type: 'CloseStream' }));
    } catch {
      // Socket may already be closing — ignore.
    }

    this.wsManager.close();
    this.cleanup();
  }

  /** Force-destroy the connection without a graceful handshake. */
  destroy(): void {
    this.log('Destroying');
    this.stopKeepAlive();

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
   * Stops the keepalive timer and marks the adapter as suspended so that
   * incoming `sendAudio` calls are silently dropped. The WebSocket itself
   * is left open; Deepgram will close it after an inactivity timeout if
   * the network truly went away.
   */
  suspend(): void {
    if (this._suspended) return;

    this._suspended = true;
    this.stopKeepAlive();
    this.log('Suspended');
  }

  /**
   * Resume after a prior `suspend()`. If the underlying connection is
   * still alive, the keepalive timer is restarted. If the connection was
   * lost while suspended, callers should `close()` / `destroy()` and
   * create a new instance.
   */
  resume(): void {
    if (!this._suspended) return;

    this._suspended = false;
    this.log('Resumed');

    if (this._connected && this.wsManager) {
      this.startKeepAlive();
    }
  }

  // -----------------------------------------------------------------------
  // Message handling
  // -----------------------------------------------------------------------

  /**
   * Parse incoming Deepgram JSON messages and emit transcript events.
   *
   * Deepgram sends `Results` messages with the following shape:
   * ```json
   * {
   *   "type": "Results",
   *   "channel": {
   *     "alternatives": [{ "transcript": "...", "confidence": 0.97 }]
   *   },
   *   "is_final": true,
   *   "speech_final": true
   * }
   * ```
   */
  private handleMessage(event: MessageEvent): void {
    // Binary messages are not expected — ignore.
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

    if (type === 'Results') {
      this.handleResultsMessage(parsed);
    } else if (type === 'Metadata') {
      this.log('Received metadata', parsed);
    } else if (type === 'Error') {
      this.log('Deepgram error', parsed);
    } else {
      this.log('Unknown message type', type, parsed);
    }
  }

  /**
   * Extract transcript data from a `Results` message and notify subscribers.
   */
  private handleResultsMessage(parsed: Record<string, unknown>): void {
    const channel = parsed['channel'] as
      | { alternatives?: { transcript?: string; confidence?: number }[] }
      | undefined;

    const alternatives = channel?.alternatives;
    if (!alternatives || alternatives.length === 0) {
      return;
    }

    const best = alternatives[0];
    if (!best) return;
    const transcript = best.transcript ?? '';
    const confidence = best.confidence ?? 0;

    // Deepgram sends empty transcripts for silence — skip those.
    if (transcript.trim() === '') {
      return;
    }

    const isFinal =
      (parsed['is_final'] === true) && (parsed['speech_final'] === true);

    const transcriptEvent: TranscriptEvent = {
      text: transcript,
      isFinal,
      confidence,
      timestamp: Date.now(),
    };

    this.log(
      isFinal ? 'Final transcript:' : 'Interim transcript:',
      transcript,
      `(${(confidence * 100).toFixed(1)}%)`,
    );

    this.emitTranscript(transcriptEvent);
  }

  // -----------------------------------------------------------------------
  // Keepalive
  // -----------------------------------------------------------------------

  /** Start the periodic KeepAlive heartbeat. */
  private startKeepAlive(): void {
    this.stopKeepAlive();

    this.keepAliveTimer = setInterval(() => {
      if (this._connected && this.wsManager && !this._suspended) {
        try {
          this.wsManager.send(JSON.stringify({ type: 'KeepAlive' }));
          this.log('Sent KeepAlive');
        } catch {
          this.log('Failed to send KeepAlive');
        }
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  /** Stop the KeepAlive heartbeat. */
  private stopKeepAlive(): void {
    if (this.keepAliveTimer !== null) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Subscriber notification
  // -----------------------------------------------------------------------

  /**
   * Emit a transcript event to all registered callbacks.
   *
   * Errors thrown by individual callbacks are caught and logged so one
   * misbehaving subscriber does not prevent others from receiving the event.
   */
  private emitTranscript(event: TranscriptEvent): void {
    for (const cb of this.transcriptCallbacks) {
      try {
        cb(event);
      } catch (err) {
        console.error(LOG_PREFIX, 'Transcript callback threw:', err);
      }
    }
  }

  // -----------------------------------------------------------------------
  // URL building
  // -----------------------------------------------------------------------

  /** Build the Deepgram streaming endpoint URL with query parameters. */
  private buildUrl(): string {
    const params = new URLSearchParams({
      model: this.model,
      language: this.language,
      punctuate: 'true',
      interim_results: 'true',
      endpointing: '300',
      token: this.apiKey,
    });

    return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /** Reset internal state after disconnection. */
  private cleanup(): void {
    this._connected = false;
    this.stopKeepAlive();
  }

  // -----------------------------------------------------------------------
  // Logging
  // -----------------------------------------------------------------------

  /** Conditional debug logging. */
  private log(...args: unknown[]): void {
    if (this.debugEnabled) {
      console.debug(LOG_PREFIX, ...args);
    }
  }
}
