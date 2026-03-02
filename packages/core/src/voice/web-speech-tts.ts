// ---------------------------------------------------------------------------
// GuideKit SDK – Web Speech API Text-to-Speech Adapter
// ---------------------------------------------------------------------------
//
// Browser-native SpeechSynthesis adapter that requires no API keys or
// external services. Uses the Web Speech API (SpeechSynthesis) available
// in all modern browsers. Designed as the zero-config default when no TTS
// provider is explicitly configured.
//
// Unlike the WebSocket-based ElevenLabsTTS adapter, this adapter does not
// stream audio chunks. Instead it uses the browser's built-in speech
// synthesis engine and returns a Promise from speak() that resolves when
// the utterance completes.
//
// SSR safe: all browser APIs are guarded behind `typeof window` checks so
// the module is safe to import at build time in SSR environments.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[GuideKit:WebSpeech-TTS]';

/** Default speech rate (1.0 is normal speed). */
const DEFAULT_RATE = 1.0;

/** Default pitch (1.0 is normal pitch). */
const DEFAULT_PITCH = 1.0;

/** Default language. */
const DEFAULT_LANGUAGE = 'en-US';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WebSpeechTTSOptions {
  voice?: string;
  rate?: number;
  pitch?: number;
  language?: string;
  debug?: boolean;
}

/**
 * Audio event compatible with the TTSAudioEvent shape used by
 * VoicePipeline for ElevenLabs TTS. Web Speech API does not produce
 * raw audio buffers, so we emit events with empty buffers and use
 * isFinal to signal utterance completion.
 */
export interface WebSpeechTTSAudioEvent {
  audio: ArrayBuffer;
  isFinal: boolean;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// WebSpeechTTS
// ---------------------------------------------------------------------------

export class WebSpeechTTS {
  // ---- Configuration -------------------------------------------------------

  private readonly voiceName: string | null;
  private readonly rate: number;
  private readonly pitch: number;
  private readonly language: string;
  private readonly debugEnabled: boolean;

  // ---- Internal state ------------------------------------------------------

  private _connected = false;
  private _suspended = false;

  /** Cached voice object resolved from voiceName. */
  private _resolvedVoice: SpeechSynthesisVoice | null = null;

  /** Whether voices have been loaded (they load async in some browsers). */
  private _voicesLoaded = false;

  /** Registered audio-event callbacks. */
  private readonly audioCallbacks: Set<(event: WebSpeechTTSAudioEvent) => void> =
    new Set();

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  constructor(options: WebSpeechTTSOptions = {}) {
    this.voiceName = options.voice ?? null;
    this.rate = options.rate ?? DEFAULT_RATE;
    this.pitch = options.pitch ?? DEFAULT_PITCH;
    this.language = options.language ?? DEFAULT_LANGUAGE;
    this.debugEnabled = options.debug ?? false;

    this.log('WebSpeechTTS created', {
      voice: this.voiceName,
      rate: this.rate,
      pitch: this.pitch,
      language: this.language,
    });
  }

  // -------------------------------------------------------------------------
  // Static methods
  // -------------------------------------------------------------------------

  /**
   * Check whether the Web Speech API SpeechSynthesis is supported in the
   * current environment. Safe to call in SSR (returns false).
   */
  static isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    return typeof window.speechSynthesis !== 'undefined';
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Whether the adapter is connected (ready for speech). */
  get isConnected(): boolean {
    return this._connected;
  }

  /**
   * Initialize the adapter.
   *
   * Loads available voices and resolves the requested voice name. Voice
   * loading is async in some browsers (notably Chrome) so we wait for
   * the `voiceschanged` event if needed.
   */
  async connect(): Promise<void> {
    if (this._connected) {
      this.log('Already connected — skipping');
      return;
    }

    // SSR guard
    if (typeof window === 'undefined' || typeof window.speechSynthesis === 'undefined') {
      this.log('SpeechSynthesis not available — cannot connect');
      return;
    }

    // Load voices
    await this.loadVoices();

    // Resolve the requested voice
    if (this.voiceName) {
      this._resolvedVoice = this.findVoice(this.voiceName);
      if (this._resolvedVoice) {
        this.log('Resolved voice:', this._resolvedVoice.name);
      } else {
        this.log('Requested voice not found:', this.voiceName, '— using browser default');
      }
    }

    this._connected = true;
    this.log('Connected');
  }

  /**
   * Speak the given text using the browser's speech synthesis engine.
   *
   * Returns a Promise that resolves when the utterance completes or is
   * cancelled. Rejects if an error occurs during synthesis.
   *
   * Also emits audio events to registered callbacks for VoicePipeline
   * compatibility.
   */
  speak(text: string): void {
    if (!this._connected || this._suspended) {
      this.log('Cannot speak — not connected or suspended');
      return;
    }

    if (!text || !text.trim()) {
      return;
    }

    // SSR guard
    if (typeof window === 'undefined' || typeof window.speechSynthesis === 'undefined') {
      return;
    }

    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);

    // Apply settings
    utterance.lang = this.language;
    utterance.rate = this.rate;
    utterance.pitch = this.pitch;

    if (this._resolvedVoice) {
      utterance.voice = this._resolvedVoice;
    }



    utterance.onstart = () => {
      this.log('Utterance started:', text.slice(0, 80) + (text.length > 80 ? '...' : ''));
      // Emit a non-final event to signal playback has started
      this.emitAudio({
        audio: new ArrayBuffer(0),
        isFinal: false,
        timestamp: Date.now(),
      });
    };

    utterance.onend = () => {
  
      this.log('Utterance ended');
      // Emit final event to signal completion
      this.emitAudio({
        audio: new ArrayBuffer(0),
        isFinal: true,
        timestamp: Date.now(),
      });
    };

    utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
  
      // 'canceled' is not a real error — it occurs when stop() is called
      if (event.error === 'canceled') {
        this.log('Utterance cancelled');
        this.emitAudio({
          audio: new ArrayBuffer(0),
          isFinal: true,
          timestamp: Date.now(),
        });
        return;
      }
      this.log('Utterance error:', event.error);
      // Still emit final to unblock the pipeline
      this.emitAudio({
        audio: new ArrayBuffer(0),
        isFinal: true,
        timestamp: Date.now(),
      });
    };

    this.log('Speaking:', text.slice(0, 80) + (text.length > 80 ? '...' : ''));
    synth.speak(utterance);
  }

  /**
   * Flush / finalize the current utterance.
   *
   * No-op for Web Speech API since each speak() call is a complete
   * utterance. Provided for interface compatibility with ElevenLabsTTS.
   */
  flush(): void {
    // Web Speech API utterances are self-contained — nothing to flush.
  }

  /**
   * Register a callback to receive audio output events.
   *
   * For Web Speech API, these events have empty audio buffers and are
   * used to signal utterance start/end for VoicePipeline state management.
   *
   * @returns An unsubscribe function. Calling it more than once is safe.
   */
  onAudio(callback: (event: WebSpeechTTSAudioEvent) => void): () => void {
    this.audioCallbacks.add(callback);

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.audioCallbacks.delete(callback);
    };
  }

  /** Stop current speech synthesis and cancel any queued utterances. */
  stop(): void {
    if (typeof window === 'undefined' || typeof window.speechSynthesis === 'undefined') {
      return;
    }

    this.log('Stopping speech synthesis');
    window.speechSynthesis.cancel();

  }

  /** Gracefully close the adapter. */
  close(): void {
    this.log('Closing');
    this.stop();
    this.cleanup();
  }

  /** Force-destroy the adapter. */
  destroy(): void {
    this.log('Destroying');
    this.stop();
    this.cleanup();
    this.audioCallbacks.clear();
  }

  /**
   * Suspend the adapter (e.g. when the device goes offline).
   *
   * Pauses any active speech synthesis and marks the adapter as suspended.
   */
  suspend(): void {
    if (this._suspended) return;

    this._suspended = true;

    if (typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined') {
      window.speechSynthesis.pause();
    }

    this.log('Suspended');
  }

  /**
   * Resume after a prior `suspend()`.
   */
  resume(): void {
    if (!this._suspended) return;

    this._suspended = false;

    if (typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined') {
      window.speechSynthesis.resume();
    }

    this.log('Resumed');
  }

  // -------------------------------------------------------------------------
  // Voice loading
  // -------------------------------------------------------------------------

  /**
   * Load available voices from the browser.
   *
   * In Chrome and some other browsers, voices load asynchronously after
   * the page loads. We wait for the `voiceschanged` event with a timeout.
   */
  private async loadVoices(): Promise<void> {
    if (this._voicesLoaded) return;
    if (typeof window === 'undefined' || typeof window.speechSynthesis === 'undefined') return;

    const synth = window.speechSynthesis;
    let voices = synth.getVoices();

    if (voices.length > 0) {
      this._voicesLoaded = true;
      this.log('Voices loaded:', voices.length, 'available');
      return;
    }

    // Wait for voiceschanged event (Chrome loads voices async)
    await new Promise<void>((resolve) => {
      const onVoicesChanged = (): void => {
        synth.removeEventListener('voiceschanged', onVoicesChanged);
        clearTimeout(timeout);
        voices = synth.getVoices();
        this._voicesLoaded = true;
        this.log('Voices loaded (async):', voices.length, 'available');
        resolve();
      };

      // Timeout after 2 seconds — some browsers never fire voiceschanged
      const timeout = setTimeout(() => {
        synth.removeEventListener('voiceschanged', onVoicesChanged);
        this._voicesLoaded = true;
        this.log('Voices loading timed out — proceeding with defaults');
        resolve();
      }, 2_000);

      synth.addEventListener('voiceschanged', onVoicesChanged);
    });
  }

  /**
   * Find a voice by name (case-insensitive partial match).
   */
  private findVoice(name: string): SpeechSynthesisVoice | null {
    if (typeof window === 'undefined' || typeof window.speechSynthesis === 'undefined') {
      return null;
    }

    const voices = window.speechSynthesis.getVoices();
    const lowerName = name.toLowerCase();

    // Try exact match first
    const exact = voices.find((v) => v.name.toLowerCase() === lowerName);
    if (exact) return exact;

    // Try partial match
    const partial = voices.find((v) => v.name.toLowerCase().includes(lowerName));
    if (partial) return partial;

    // Try matching by language if voice name looks like a language code
    if (lowerName.includes('-') || lowerName.length <= 5) {
      const langMatch = voices.find((v) => v.lang.toLowerCase().startsWith(lowerName));
      if (langMatch) return langMatch;
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Subscriber notification
  // -------------------------------------------------------------------------

  /**
   * Emit an audio event to all registered callbacks.
   *
   * Errors thrown by individual callbacks are caught and logged so one
   * misbehaving subscriber does not prevent others from receiving the event.
   */
  private emitAudio(event: WebSpeechTTSAudioEvent): void {
    for (const cb of this.audioCallbacks) {
      try {
        cb(event);
      } catch (err) {
        console.error(LOG_PREFIX, 'Audio callback threw:', err);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /** Reset internal state. */
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
