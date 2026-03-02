// ---------------------------------------------------------------------------
// GuideKit SDK – ElevenLabs Real-Time Text-to-Speech Adapter
// ---------------------------------------------------------------------------
//
// Streams text to ElevenLabs over a WebSocket and receives audio chunks in
// real time. Designed for browser use; all browser-only APIs are guarded
// behind `typeof window` checks so the module is safe to import at build
// time in SSR environments.
// ---------------------------------------------------------------------------

import { WebSocketManager } from './websocket-manager.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[GuideKit:TTS]';

/** Default ElevenLabs voice ID (Rachel). */
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

/** Default model — ElevenLabs Flash v2.5 for lowest latency. */
const DEFAULT_MODEL_ID = 'eleven_flash_v2_5';

/** Default voice stability setting (0–1). */
const DEFAULT_STABILITY = 0.5;

/** Default similarity boost setting (0–1). */
const DEFAULT_SIMILARITY_BOOST = 0.75;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ElevenLabsTTSOptions {
  apiKey: string;
  voiceId?: string;
  modelId?: string;
  debug?: boolean;
}

export interface TTSAudioEvent {
  audio: ArrayBuffer;
  /** Whether this is the final chunk for the current utterance. */
  isFinal: boolean;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decode a base64-encoded string into an `ArrayBuffer`.
 *
 * Uses the native `atob` function available in browsers. In SSR contexts
 * the adapter will never reach this code path because `connect()` is
 * guarded by a WebSocket availability check.
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const length = binaryString.length;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// ---------------------------------------------------------------------------
// ElevenLabsTTS
// ---------------------------------------------------------------------------

export class ElevenLabsTTS {
  // ---- Configuration ------------------------------------------------------

  private readonly apiKey: string;
  private readonly voiceId: string;
  private readonly modelId: string;
  private readonly debugEnabled: boolean;

  // ---- Internal state -----------------------------------------------------

  private wsManager: WebSocketManager | null = null;
  private _connected = false;
  private _suspended = false;

  /**
   * Whether the BOS (beginning-of-stream) handshake has been sent for the
   * current WebSocket session. ElevenLabs requires the first message to
   * contain voice settings and the API key before any text chunks.
   */
  private bosSent = false;

  /** Registered audio-event callbacks. */
  private readonly audioCallbacks: Set<(event: TTSAudioEvent) => void> =
    new Set();

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(options: ElevenLabsTTSOptions) {
    this.apiKey = options.apiKey;
    this.voiceId = options.voiceId ?? DEFAULT_VOICE_ID;
    this.modelId = options.modelId ?? DEFAULT_MODEL_ID;
    this.debugEnabled = options.debug ?? false;

    this.log('ElevenLabsTTS created', {
      voiceId: this.voiceId,
      modelId: this.modelId,
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
   * Open a WebSocket connection to the ElevenLabs streaming TTS endpoint.
   *
   * Resolves once the connection is established and the BOS handshake has
   * been sent. Rejects if the connection cannot be established.
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
    this.log('Connecting to', url);

    this.wsManager = new WebSocketManager({
      url,
      protocols: [],
      debug: this.debugEnabled,
      label: 'ElevenLabs-TTS',
    });

    this.wsManager.onOpen(() => {
      this._connected = true;
      this.sendBOS();
      this.log('Connected and BOS sent');
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
   * Send text to be synthesised into speech.
   *
   * May be called multiple times to stream text incrementally. Each call
   * sends a text chunk with `try_trigger_generation: true` so ElevenLabs
   * can begin synthesising as soon as it has enough context.
   *
   * Call {@link flush} when the complete utterance has been sent.
   */
  speak(text: string): void {
    if (!this._connected || !this.wsManager || this._suspended) {
      this.log('Cannot speak — not connected or suspended');
      return;
    }

    if (!text) {
      return;
    }

    const message = JSON.stringify({
      text,
      try_trigger_generation: true,
    });

    this.log('Sending text chunk:', text.slice(0, 80) + (text.length > 80 ? '...' : ''));
    this.wsManager.send(message);
  }

  /**
   * Signal the end of text input for the current utterance.
   *
   * Sends the EOS (end-of-stream) marker to ElevenLabs. The server will
   * flush any remaining audio and send a final chunk with `isFinal: true`.
   */
  flush(): void {
    if (!this._connected || !this.wsManager || this._suspended) {
      this.log('Cannot flush — not connected or suspended');
      return;
    }

    const message = JSON.stringify({ text: '' });
    this.log('Sending EOS (flush)');
    this.wsManager.send(message);
  }

  /**
   * Register a callback to receive audio output events.
   *
   * @returns An unsubscribe function. Calling it more than once is safe.
   */
  onAudio(callback: (event: TTSAudioEvent) => void): () => void {
    this.audioCallbacks.add(callback);

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.audioCallbacks.delete(callback);
    };
  }

  /** Gracefully close the connection by sending EOS then closing. */
  close(): void {
    if (!this._connected || !this.wsManager) {
      this.log('Not connected — nothing to close');
      return;
    }

    this.log('Closing connection');

    // Send EOS to let the server finalise any pending audio.
    try {
      this.wsManager.send(JSON.stringify({ text: '' }));
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
    this.audioCallbacks.clear();
  }

  /**
   * Suspend the adapter (e.g. when the device goes offline).
   *
   * Marks the adapter as suspended so that calls to `speak()` and `flush()`
   * are silently dropped. The WebSocket itself is left open; ElevenLabs
   * will close it after an inactivity timeout if the network went away.
   */
  suspend(): void {
    if (this._suspended) return;

    this._suspended = true;
    this.log('Suspended');
  }

  /**
   * Resume after a prior `suspend()`. If the underlying connection is
   * still alive, the adapter returns to normal operation. If the connection
   * was lost while suspended, callers should `close()` / `destroy()` and
   * create a new instance.
   */
  resume(): void {
    if (!this._suspended) return;

    this._suspended = false;
    this.log('Resumed');
  }

  // -----------------------------------------------------------------------
  // BOS handshake
  // -----------------------------------------------------------------------

  /**
   * Send the BOS (beginning-of-stream) message.
   *
   * This must be the very first message on a new WebSocket session. It
   * carries the API key and voice settings.
   */
  private sendBOS(): void {
    if (!this.wsManager || this.bosSent) {
      return;
    }

    const bos = JSON.stringify({
      text: ' ',
      voice_settings: {
        stability: DEFAULT_STABILITY,
        similarity_boost: DEFAULT_SIMILARITY_BOOST,
      },
      xi_api_key: this.apiKey,
    });

    this.wsManager.send(bos);
    this.bosSent = true;
    this.log('BOS handshake sent');
  }

  // -----------------------------------------------------------------------
  // Message handling
  // -----------------------------------------------------------------------

  /**
   * Parse incoming ElevenLabs JSON messages and emit audio events.
   *
   * ElevenLabs sends messages with the following shape:
   * ```json
   * { "audio": "base64encoded...", "isFinal": false }
   * ```
   *
   * When `isFinal` is `true`, the server has finished synthesising the
   * current utterance (i.e. after EOS was sent).
   */
  private handleMessage(event: MessageEvent): void {
    // Binary messages are not expected from ElevenLabs — ignore.
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

    // Handle error responses from ElevenLabs.
    if (parsed['error'] !== undefined) {
      this.log('ElevenLabs error:', parsed['error']);
      return;
    }

    // Handle alignment / metadata messages (no audio payload).
    if (parsed['audio'] === undefined || parsed['audio'] === null) {
      this.log('Non-audio message received', parsed);
      return;
    }

    const audioBase64 = parsed['audio'] as string;
    const isFinal = parsed['isFinal'] === true;

    // Skip empty audio chunks.
    if (!audioBase64 || audioBase64.length === 0) {
      if (isFinal) {
        // Emit a final event even without audio so consumers know the
        // utterance has ended.
        this.emitAudio({
          audio: new ArrayBuffer(0),
          isFinal: true,
          timestamp: Date.now(),
        });
      }
      return;
    }

    let audioBuffer: ArrayBuffer;
    try {
      audioBuffer = base64ToArrayBuffer(audioBase64);
    } catch (err) {
      this.log('Failed to decode base64 audio', err);
      return;
    }

    const audioEvent: TTSAudioEvent = {
      audio: audioBuffer,
      isFinal,
      timestamp: Date.now(),
    };

    this.log(
      isFinal ? 'Final audio chunk:' : 'Audio chunk:',
      `${audioBuffer.byteLength} bytes`,
    );

    this.emitAudio(audioEvent);
  }

  // -----------------------------------------------------------------------
  // Subscriber notification
  // -----------------------------------------------------------------------

  /**
   * Emit an audio event to all registered callbacks.
   *
   * Errors thrown by individual callbacks are caught and logged so one
   * misbehaving subscriber does not prevent others from receiving the event.
   */
  private emitAudio(event: TTSAudioEvent): void {
    for (const cb of this.audioCallbacks) {
      try {
        cb(event);
      } catch (err) {
        console.error(LOG_PREFIX, 'Audio callback threw:', err);
      }
    }
  }

  // -----------------------------------------------------------------------
  // URL building
  // -----------------------------------------------------------------------

  /** Build the ElevenLabs streaming TTS endpoint URL. */
  private buildUrl(): string {
    const params = new URLSearchParams({
      model_id: this.modelId,
    });

    return `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.voiceId)}/stream-input?${params.toString()}`;
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /** Reset internal state after disconnection. */
  private cleanup(): void {
    this._connected = false;
    this.bosSent = false;
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
