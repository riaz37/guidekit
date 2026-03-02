// ---------------------------------------------------------------------------
// GuideKit SDK – Web Speech API Speech-to-Text Adapter
// ---------------------------------------------------------------------------
//
// Browser-native SpeechRecognition adapter that requires no API keys or
// external services. Uses the Web Speech API (SpeechRecognition) available
// in most modern browsers. Designed as the zero-config default when no STT
// provider is explicitly configured.
//
// SSR safe: all browser APIs are guarded behind `typeof window` checks so
// the module is safe to import at build time in SSR environments.
// ---------------------------------------------------------------------------

import type { STTTranscriptEvent } from '../types/index.js';

// Re-export the shared type for consumers that only import from this module
export type { STTTranscriptEvent };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[GuideKit:WebSpeech-STT]';

/** Default language for speech recognition. */
const DEFAULT_LANGUAGE = 'en-US';

// ---------------------------------------------------------------------------
// Browser type declarations
// ---------------------------------------------------------------------------

/**
 * Minimal type declarations for the Web Speech API SpeechRecognition
 * interface. These cover the subset used by this adapter. Full type
 * definitions are available in lib.dom.d.ts but may not be present in
 * all TS configurations.
 */
interface SpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionErrorEvent {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

// Extend globalThis for webkit-prefixed SpeechRecognition
declare global {
  // eslint-disable-next-line no-var
  var webkitSpeechRecognition: SpeechRecognitionConstructor | undefined;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WebSpeechSTTOptions {
  language?: string;
  continuous?: boolean;
  interimResults?: boolean;
  debug?: boolean;
}

// ---------------------------------------------------------------------------
// WebSpeechSTT
// ---------------------------------------------------------------------------

export class WebSpeechSTT {
  // ---- Configuration -------------------------------------------------------

  private readonly language: string;
  private readonly continuous: boolean;
  private readonly interimResultsEnabled: boolean;
  private readonly debugEnabled: boolean;

  // ---- Internal state ------------------------------------------------------

  private recognition: SpeechRecognitionInstance | null = null;
  private _connected = false;
  private _suspended = false;

  /**
   * Whether we intentionally stopped recognition. Used to distinguish
   * between intentional stop and unexpected end (for auto-restart in
   * continuous mode).
   */
  private _intentionalStop = false;

  /** Registered transcript callbacks. */
  private readonly transcriptCallbacks: Set<(event: STTTranscriptEvent) => void> =
    new Set();

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  constructor(options: WebSpeechSTTOptions = {}) {
    this.language = options.language ?? DEFAULT_LANGUAGE;
    this.continuous = options.continuous ?? true;
    this.interimResultsEnabled = options.interimResults ?? true;
    this.debugEnabled = options.debug ?? false;

    this.log('WebSpeechSTT created', {
      language: this.language,
      continuous: this.continuous,
      interimResults: this.interimResultsEnabled,
    });
  }

  // -------------------------------------------------------------------------
  // Static methods
  // -------------------------------------------------------------------------

  /**
   * Check whether the Web Speech API SpeechRecognition is supported in the
   * current environment. Safe to call in SSR (returns false).
   */
  static isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    return (
      typeof (window as unknown as Record<string, unknown>)['SpeechRecognition'] !== 'undefined' ||
      typeof globalThis.webkitSpeechRecognition !== 'undefined'
    );
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Whether recognition is currently active and connected. */
  get isConnected(): boolean {
    return this._connected;
  }

  /**
   * Start speech recognition.
   *
   * Creates the SpeechRecognition instance and begins listening. Resolves
   * once the recognition session has started. Rejects if the API is not
   * supported or the browser denies permission.
   */
  async connect(): Promise<void> {
    if (this._connected) {
      this.log('Already connected — skipping');
      return;
    }

    // SSR guard
    if (typeof window === 'undefined') {
      this.log('SSR environment detected — cannot connect');
      return;
    }

    const SpeechRecognitionClass = this.resolveSpeechRecognition();
    if (!SpeechRecognitionClass) {
      throw new Error(
        'Web Speech API (SpeechRecognition) is not supported in this browser.',
      );
    }

    this.recognition = new SpeechRecognitionClass();
    this.recognition.lang = this.language;
    this.recognition.continuous = this.continuous;
    this.recognition.interimResults = this.interimResultsEnabled;
    this.recognition.maxAlternatives = 1;

    // Wire event handlers
    this.recognition.onstart = () => {
      this._connected = true;
      this._intentionalStop = false;
      this.log('Recognition started');
    };

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      this.handleResult(event);
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      this.handleError(event);
    };

    this.recognition.onend = () => {
      this.log('Recognition ended');
      const wasConnected = this._connected;
      this._connected = false;

      // In continuous mode, auto-restart if not intentionally stopped
      // and we were previously connected (not an error during startup).
      if (
        this.continuous &&
        !this._intentionalStop &&
        !this._suspended &&
        wasConnected
      ) {
        this.log('Auto-restarting continuous recognition');
        try {
          this.recognition?.start();
        } catch {
          this.log('Failed to auto-restart recognition');
        }
      }
    };

    // Start recognition
    return new Promise<void>((resolve, reject) => {
      const onStart = (): void => {
        cleanup();
        resolve();
      };

      const onError = (event: SpeechRecognitionErrorEvent): void => {
        cleanup();
        reject(new Error(`SpeechRecognition error: ${event.error} — ${event.message}`));
      };

      const cleanup = (): void => {
        if (this.recognition) {
          // Remove the one-shot listeners (keep the persistent ones)
          this.recognition.removeEventListener('start', onStart as unknown as EventListener);
          this.recognition.removeEventListener('error', onError as unknown as EventListener);
        }
      };

      this.recognition!.addEventListener('start', onStart as unknown as EventListener, { once: true });
      this.recognition!.addEventListener('error', onError as unknown as EventListener, { once: true });

      try {
        this.recognition!.start();
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }

  /**
   * Send audio data. No-op for Web Speech API since it captures audio
   * directly from the microphone via the browser's internal pipeline.
   *
   * Provided for interface compatibility with WebSocket-based STT adapters
   * (DeepgramSTT, ElevenLabsSTT).
   */
  sendAudio(_audioData: Float32Array | Int16Array): void {
    // Web Speech API manages its own audio capture — nothing to do here.
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
   * Gracefully stop recognition.
   *
   * Calls `stop()` on the SpeechRecognition instance which allows it to
   * deliver any pending final results before ending.
   */
  close(): void {
    if (!this.recognition) {
      this.log('Not connected — nothing to close');
      return;
    }

    this.log('Closing recognition');
    this._intentionalStop = true;

    try {
      this.recognition.stop();
    } catch {
      // Recognition may already be stopped
    }

    this.cleanup();
  }

  /** Force-destroy the recognition without waiting for pending results. */
  destroy(): void {
    this.log('Destroying');
    this._intentionalStop = true;

    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // Recognition may already be stopped
      }
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onend = null;
      this.recognition.onstart = null;
      this.recognition = null;
    }

    this.cleanup();
    this.transcriptCallbacks.clear();
  }

  /**
   * Suspend the adapter (e.g. when the device goes offline).
   *
   * Stops recognition and marks the adapter as suspended so that auto-restart
   * does not trigger.
   */
  suspend(): void {
    if (this._suspended) return;

    this._suspended = true;
    this._intentionalStop = true;

    if (this.recognition && this._connected) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore
      }
    }

    this.log('Suspended');
  }

  /**
   * Resume after a prior `suspend()`. Restarts recognition if it was
   * running before suspension.
   */
  resume(): void {
    if (!this._suspended) return;

    this._suspended = false;
    this._intentionalStop = false;
    this.log('Resumed');

    // Restart recognition if we have an instance
    if (this.recognition && !this._connected) {
      try {
        this.recognition.start();
      } catch {
        this.log('Failed to restart recognition after resume');
      }
    }
  }

  // -------------------------------------------------------------------------
  // Result handling
  // -------------------------------------------------------------------------

  /**
   * Handle SpeechRecognition result events.
   *
   * The `results` property is a SpeechRecognitionResultList containing all
   * results accumulated during this recognition session. We only process
   * results from `resultIndex` onward to avoid re-emitting old results.
   */
  private handleResult(event: SpeechRecognitionEvent): void {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result) continue;

      const alternative = result[0];
      if (!alternative) continue;

      const transcript = alternative.transcript;
      if (!transcript || transcript.trim() === '') continue;

      const isFinal = result.isFinal;
      // Web Speech API confidence is 0 for interim results in some browsers
      const confidence = alternative.confidence > 0 ? alternative.confidence : 0.85;

      const transcriptEvent: STTTranscriptEvent = {
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
  }

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  /**
   * Handle SpeechRecognition errors.
   *
   * Some errors are recoverable (e.g. `no-speech`) and some are fatal
   * (e.g. `not-allowed`). For recoverable errors in continuous mode,
   * recognition will auto-restart via the `onend` handler.
   */
  private handleError(event: SpeechRecognitionErrorEvent): void {
    const errorType = event.error;

    this.log('Recognition error:', errorType, event.message);

    // 'no-speech' and 'aborted' are common non-fatal errors
    // In continuous mode, the onend handler will auto-restart
    if (errorType === 'no-speech' || errorType === 'aborted') {
      this.log('Non-fatal error — will recover');
      return;
    }

    // 'network' errors may be transient
    if (errorType === 'network') {
      this.log('Network error — recognition may auto-restart');
      return;
    }

    // Fatal errors: 'not-allowed', 'service-not-allowed', 'language-not-supported'
    // For these, mark as intentionally stopped to prevent auto-restart
    if (
      errorType === 'not-allowed' ||
      errorType === 'service-not-allowed' ||
      errorType === 'language-not-supported'
    ) {
      this._intentionalStop = true;
      this.log('Fatal recognition error — stopping');
    }
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
  // SpeechRecognition resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve the SpeechRecognition constructor, with the webkit-prefixed
   * fallback. Returns null if not available.
   */
  private resolveSpeechRecognition(): SpeechRecognitionConstructor | null {
    if (typeof window === 'undefined') return null;

    const win = window as unknown as Record<string, unknown>;
    if (typeof win['SpeechRecognition'] !== 'undefined') {
      return win['SpeechRecognition'] as SpeechRecognitionConstructor;
    }
    if (typeof globalThis.webkitSpeechRecognition !== 'undefined') {
      return globalThis.webkitSpeechRecognition;
    }
    return null;
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
