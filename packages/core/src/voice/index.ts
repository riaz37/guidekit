// ---------------------------------------------------------------------------
// GuideKit SDK – Voice Pipeline (Phase 1b)
// ---------------------------------------------------------------------------
//
// Orchestrates the full voice flow: Mic → VAD → STT → LLM → TTS → Speaker.
//
// Half-duplex state machine:
//   IDLE ──startListening()──► LISTENING
//   LISTENING ──final transcript──► PROCESSING
//   PROCESSING ──LLM response──► SPEAKING
//   SPEAKING ──TTS done──► IDLE
//   SPEAKING ──barge-in──► LISTENING
//   Any ──error──► ERROR
//   ERROR ──startListening()──► LISTENING
//
// SSR safe: all browser APIs are guarded behind `typeof window` checks.
// AudioContext is only created in init() which must be called after a user
// gesture to satisfy browser autoplay policies.
// ---------------------------------------------------------------------------

import { EventBus, createEventBus } from '../bus/index.js';
import { BrowserSupportError, ErrorCodes, PermissionError } from '../errors/index.js';
import { DeepgramSTT } from './deepgram-stt.js';
import { ElevenLabsSTT } from './elevenlabs-stt.js';
import { ElevenLabsTTS } from './elevenlabs-tts.js';
import { WebSpeechSTT } from './web-speech-stt.js';
import { WebSpeechTTS } from './web-speech-tts.js';

import type { STTTranscriptEvent } from '../types/index.js';
import type { TTSAudioEvent } from './elevenlabs-tts.js';
import type { WebSpeechTTSAudioEvent } from './web-speech-tts.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[GuideKit:Voice]';

/** Jitter buffer: accumulate this many ms of audio before starting playback. */
const JITTER_BUFFER_MS = 150;

/** Echo detection: discard transcript if >60% word overlap within this window. */
const ECHO_WINDOW_MS = 3_000;

/** Echo detection: minimum word overlap ratio to classify as echo. */
const ECHO_OVERLAP_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

export interface VoicePipelineOptions {
  sttConfig:
    | { provider: 'deepgram'; apiKey: string; model?: 'nova-2' | 'nova-3' }
    | { provider: 'elevenlabs'; apiKey: string; language?: string }
    | { provider: 'web-speech'; language?: string; continuous?: boolean; interimResults?: boolean };
  ttsConfig:
    | { provider: 'elevenlabs'; apiKey: string; voiceId?: string; modelId?: string }
    | { provider: 'web-speech'; voice?: string; rate?: number; pitch?: number; language?: string };
  debug?: boolean;
}

// ---------------------------------------------------------------------------
// Type declarations for environments with webkitAudioContext
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var webkitAudioContext: typeof AudioContext | undefined;
}

// ---------------------------------------------------------------------------
// Internals: VAD interface (dynamically imported from @guidekit/vad)
// ---------------------------------------------------------------------------

/**
 * Minimal interface mirroring the public API of SileroVAD from @guidekit/vad.
 * Declared here so we can type the dynamically imported instance without a
 * hard compile-time dependency.
 */
interface VADInstance {
  init(): Promise<void>;
  start(stream: MediaStream): void;
  stop(): void;
  destroy(): Promise<void>;
  onSpeechStart(cb: (event: { type: string; timestamp: number; probability?: number }) => void): () => void;
  onSpeechEnd(cb: (event: { type: string; timestamp: number; probability?: number }) => void): () => void;
  readonly isSpeaking: boolean;
  readonly isReady: boolean;
}

// ---------------------------------------------------------------------------
// Internals: Echo tracker
// ---------------------------------------------------------------------------

interface EchoRecord {
  words: Set<string>;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// VoicePipeline
// ---------------------------------------------------------------------------

export class VoicePipeline {
  // ── Configuration ────────────────────────────────────────────────────
  private readonly _sttConfig: VoicePipelineOptions['sttConfig'];
  private readonly _ttsConfig: VoicePipelineOptions['ttsConfig'];
  private readonly _debug: boolean;

  // ── State ────────────────────────────────────────────────────────────
  private _state: VoiceState = 'idle';
  private _destroyed = false;

  // ── EventBus (internal, for voice-specific events) ──────────────────
  private readonly _bus: EventBus;

  // ── Audio pipeline components ────────────────────────────────────────
  private _audioContext: AudioContext | null = null;
  private _mediaStream: MediaStream | null = null;
  private _vad: VADInstance | null = null;
  private _stt: DeepgramSTT | ElevenLabsSTT | WebSpeechSTT | null = null;
  private _tts: ElevenLabsTTS | WebSpeechTTS | null = null;

  // ── Audio capture (mic → ScriptProcessor → STT) ─────────────────────
  private _micSourceNode: MediaStreamAudioSourceNode | null = null;
  private _captureProcessor: ScriptProcessorNode | null = null;
  private _isForwardingToSTT = false;

  // ── TTS playback ────────────────────────────────────────────────────
  private _playbackQueue: ArrayBuffer[] = [];
  private _jitterBufferTimer: ReturnType<typeof setTimeout> | null = null;
  private _isPlaybackStarted = false;
  private _nextPlaybackTime = 0;
  private _activeSourceNodes: Set<AudioBufferSourceNode> = new Set();
  private _lastScheduledSource: AudioBufferSourceNode | null = null;

  // ── Echo detection ──────────────────────────────────────────────────
  private _lastTTSEcho: EchoRecord | null = null;

  // ── Barge-in / abort ────────────────────────────────────────────────
  private _pendingLLMAbort: AbortController | null = null;

  // ── Subscriber management ───────────────────────────────────────────
  private readonly _stateChangeCallbacks: Set<(state: VoiceState, previous: VoiceState) => void> = new Set();
  private readonly _transcriptCallbacks: Set<(text: string, isFinal: boolean) => void> = new Set();

  // ── Cleanup handles ─────────────────────────────────────────────────
  private _unsubVADSpeechStart: (() => void) | null = null;
  private _unsubVADSpeechEnd: (() => void) | null = null;
  private _unsubSTTTranscript: (() => void) | null = null;
  private _unsubTTSAudio: (() => void) | null = null;

  // ────────────────────────────────────────────────────────────────────
  // Constructor
  // ────────────────────────────────────────────────────────────────────

  constructor(options: VoicePipelineOptions) {
    this._sttConfig = options.sttConfig;
    this._ttsConfig = options.ttsConfig;
    this._debug = options.debug ?? false;
    this._bus = createEventBus({ debug: this._debug });

    this._log('VoicePipeline created');
  }

  // ────────────────────────────────────────────────────────────────────
  // Public getters
  // ────────────────────────────────────────────────────────────────────

  /** Current pipeline state. */
  get state(): VoiceState {
    return this._state;
  }

  // ────────────────────────────────────────────────────────────────────
  // init() — call after user gesture
  // ────────────────────────────────────────────────────────────────────

  /**
   * Initialize AudioContext, VAD model, and STT/TTS connections.
   *
   * **Must be called in response to a user gesture** (click / tap) to
   * satisfy browser autoplay policies.
   */
  async init(): Promise<void> {
    if (this._destroyed) {
      this._log('Cannot init — pipeline is destroyed');
      return;
    }

    // SSR guard
    if (typeof window === 'undefined') {
      this._log('SSR environment detected — skipping init');
      return;
    }

    if (this._audioContext) {
      this._log('Already initialized — skipping');
      return;
    }

    this._log('Initializing...');

    // ── 1. Create AudioContext ───────────────────────────────────────
    const AudioContextClass = this._resolveAudioContext();
    if (!AudioContextClass) {
      throw new BrowserSupportError({
        code: ErrorCodes.BROWSER_NO_WEB_AUDIO,
        message: 'Web Audio API is not supported in this browser.',
        suggestion: 'Use a modern browser such as Chrome, Firefox, or Safari.',
      });
    }

    this._audioContext = new AudioContextClass();
    this._log('AudioContext created, sampleRate:', this._audioContext.sampleRate);

    // Pre-warm the AudioContext with a silent buffer to avoid first-play delay
    this._prewarmAudioContext(this._audioContext);

    // ── 2. Load VAD model ───────────────────────────────────────────
    try {
      const vadModule = await import('@guidekit/vad');
      const SileroVAD = vadModule.SileroVAD;
      this._vad = new SileroVAD({ debug: this._debug }) as unknown as VADInstance;
      await this._vad.init();
      this._log('VAD model loaded');
    } catch (err) {
      throw new BrowserSupportError({
        code: ErrorCodes.VAD_PACKAGE_MISSING,
        message:
          'Failed to load @guidekit/vad. Ensure the package is installed.',
        suggestion:
          'Run: npm install @guidekit/vad — or check that WASM is supported.',
        cause: err instanceof Error ? err : undefined,
      });
    }

    // ── 3. Create STT adapter ───────────────────────────────────────
    if (this._sttConfig.provider === 'deepgram') {
      this._stt = new DeepgramSTT({
        apiKey: this._sttConfig.apiKey,
        model: this._sttConfig.model,
        debug: this._debug,
      });
    } else if (this._sttConfig.provider === 'elevenlabs') {
      this._stt = new ElevenLabsSTT({
        apiKey: this._sttConfig.apiKey,
        language: this._sttConfig.language,
        debug: this._debug,
      });
    } else {
      // web-speech provider (browser-native, zero-config)
      this._stt = new WebSpeechSTT({
        language: this._sttConfig.language,
        continuous: this._sttConfig.continuous,
        interimResults: this._sttConfig.interimResults,
        debug: this._debug,
      });
    }

    // ── 4. Create TTS adapter ───────────────────────────────────────
    if (this._ttsConfig.provider === 'elevenlabs') {
      this._tts = new ElevenLabsTTS({
        apiKey: this._ttsConfig.apiKey,
        voiceId: this._ttsConfig.voiceId,
        modelId: 'modelId' in this._ttsConfig ? this._ttsConfig.modelId : undefined,
        debug: this._debug,
      });
    } else {
      // web-speech provider (browser-native, zero-config)
      this._tts = new WebSpeechTTS({
        voice: this._ttsConfig.voice,
        rate: this._ttsConfig.rate,
        pitch: this._ttsConfig.pitch,
        language: this._ttsConfig.language,
        debug: this._debug,
      });
    }

    this._log('Initialization complete');
  }

  // ────────────────────────────────────────────────────────────────────
  // startListening()
  // ────────────────────────────────────────────────────────────────────

  /**
   * Start listening: activate microphone, begin VAD + STT pipeline.
   *
   * Valid from: IDLE, ERROR, SPEAKING (barge-in path calls this internally).
   */
  async startListening(): Promise<void> {
    if (this._destroyed) return;

    if (!this._audioContext || !this._vad || !this._stt) {
      throw new BrowserSupportError({
        code: ErrorCodes.BROWSER_NO_WEB_AUDIO,
        message: 'Voice pipeline not initialized. Call init() first.',
        suggestion: 'Ensure init() is called after a user gesture before startListening().',
      });
    }

    // Resume AudioContext if it was suspended (browser policy)
    if (this._audioContext.state === 'suspended') {
      try {
        await this._audioContext.resume();
      } catch {
        // Ignore resume errors — the context may auto-resume on interaction
      }
    }

    // ── Get mic access ──────────────────────────────────────────────
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new BrowserSupportError({
        code: ErrorCodes.BROWSER_NO_WEB_AUDIO,
        message: 'navigator.mediaDevices is not available. A secure context (HTTPS) is required for microphone access.',
        suggestion: 'Serve your app over HTTPS or use localhost with a secure context.',
      });
      this._setState('error');
      this._bus.emit('error', err);
      throw err;
    }

    try {
      this._mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      this._log('Microphone access granted');
    } catch (err) {
      const isNotAllowed =
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');

      if (isNotAllowed) {
        const permErr = new PermissionError({
          code: ErrorCodes.PERMISSION_MIC_DENIED,
          message: 'Microphone permission was denied by the user.',
          suggestion: 'Allow microphone access in your browser settings and try again.',
        });
        this._setState('error');
        this._bus.emit('error', permErr);
        throw permErr;
      }

      const unavailErr = new PermissionError({
        code: ErrorCodes.PERMISSION_MIC_UNAVAILABLE,
        message: 'No microphone device available.',
        suggestion: 'Connect a microphone and try again.',
        cause: err instanceof Error ? err : undefined,
      });
      this._setState('error');
      this._bus.emit('error', unavailErr);
      throw unavailErr;
    }

    // ── Connect STT ─────────────────────────────────────────────────
    try {
      await this._stt.connect();
      this._log('STT connected');
    } catch (_err) {
      this._log('STT connection failed — degrading to text mode');
      this._bus.emit('voice:degraded', { reason: 'STT connection failed', fallback: 'text' });
      this._stopMicTracks();
      this._setState('error');
      return;
    }

    // ── Wire STT transcript events ──────────────────────────────────
    this._unsubSTTTranscript?.();
    this._unsubSTTTranscript = this._stt.onTranscript((event: STTTranscriptEvent) => {
      this._handleTranscript(event);
    });

    // ── Set up mic → ScriptProcessor for STT forwarding ─────────────
    this._setupMicCapture();

    // ── Start VAD on the MediaStream ────────────────────────────────
    this._unsubVADSpeechStart?.();
    this._unsubVADSpeechEnd?.();

    this._unsubVADSpeechStart = this._vad.onSpeechStart(() => {
      this._handleVADSpeechStart();
    });
    this._unsubVADSpeechEnd = this._vad.onSpeechEnd(() => {
      this._handleVADSpeechEnd();
    });

    this._vad.start(this._mediaStream);
    this._log('VAD started');

    // ── Transition state ────────────────────────────────────────────
    this._setState('listening');
  }

  // ────────────────────────────────────────────────────────────────────
  // stopListening()
  // ────────────────────────────────────────────────────────────────────

  /** Stop listening: deactivate mic and VAD. */
  stopListening(): void {
    if (this._destroyed) return;

    this._log('stopListening()');
    this._isForwardingToSTT = false;
    this._teardownMicCapture();
    this._vad?.stop();
    this._stt?.close();
    this._stopMicTracks();

    if (this._state === 'listening') {
      this._setState('idle');
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // processTranscript()
  // ────────────────────────────────────────────────────────────────────

  /**
   * Process a transcript through an LLM callback and speak the response.
   *
   * @param text - The user's transcript text.
   * @param sendToLLM - Async callback that sends text to the LLM and returns the response.
   */
  async processTranscript(
    text: string,
    sendToLLM: (text: string) => Promise<string>,
  ): Promise<void> {
    if (this._destroyed) return;

    this._setState('processing');

    // Set up abort controller for barge-in
    this._pendingLLMAbort = new AbortController();
    const signal = this._pendingLLMAbort.signal;

    let response: string;
    try {
      response = await sendToLLM(text);

      // Check if aborted during LLM call (barge-in)
      if (signal.aborted) {
        this._log('LLM response discarded (barge-in during processing)');
        return;
      }
    } catch (err) {
      if (signal.aborted) {
        this._log('LLM call aborted (barge-in)');
        return;
      }
      this._log('LLM call failed:', err);
      this._setState('error');
      return;
    } finally {
      this._pendingLLMAbort = null;
    }

    // Speak the response
    if (response && response.trim()) {
      await this.speak(response);
    } else {
      this._setState('idle');
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // speak()
  // ────────────────────────────────────────────────────────────────────

  /** Speak text via TTS (ElevenLabs or Web Speech API). */
  async speak(text: string): Promise<void> {
    if (this._destroyed || !text.trim()) return;

    // Web Speech TTS does not require AudioContext for playback
    const isWebSpeechTTS = this._tts instanceof WebSpeechTTS;
    if (!this._tts || (!this._audioContext && !isWebSpeechTTS)) {
      this._log('TTS or AudioContext not available — cannot speak');
      this._bus.emit('voice:degraded', { reason: 'TTS not available', fallback: 'text' });
      this._setState('idle');
      return;
    }

    this._setState('speaking');
    // Record echo info for later detection
    this._lastTTSEcho = {
      words: new Set(this._normalizeWords(text)),
      timestamp: Date.now(),
    };

    this._bus.emit('voice:tts-start', { utterance: text });

    // Connect TTS if needed
    try {
      if (!this._tts.isConnected) {
        await this._tts.connect();
        this._log('TTS connected');
      }
    } catch (_err) {
      this._log('TTS connection failed — degrading to text mode');
      this._bus.emit('voice:degraded', { reason: 'TTS connection failed', fallback: 'text' });
      this._bus.emit('voice:tts-end', { utterance: text, durationMs: 0 });
      this._setState('idle');
      return;
    }

    // Reset playback state
    this._playbackQueue = [];
    this._isPlaybackStarted = false;
    this._nextPlaybackTime = 0;
    this._jitterBufferTimer = null;

    // Wire TTS audio events
    this._unsubTTSAudio?.();
    const ttsStartTime = Date.now();

    await new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        this._unsubTTSAudio?.();
        this._unsubTTSAudio = null;

        const durationMs = Date.now() - ttsStartTime;
        this._bus.emit('voice:tts-end', { utterance: text, durationMs });

        // Only transition to idle if still in speaking state
        // (barge-in may have already changed state)
        if (this._state === 'speaking') {
          this._setState('idle');
        }
        resolve();
      };

      if (isWebSpeechTTS) {
        // Web Speech TTS: browser handles audio playback internally.
        // We only listen for start/end events to manage pipeline state.
        this._unsubTTSAudio = (this._tts as WebSpeechTTS).onAudio(
          (event: WebSpeechTTSAudioEvent) => {
            if (event.isFinal) {
              done();
            }
          },
        );
        (this._tts as WebSpeechTTS).speak(text);
      } else {
        // ElevenLabs TTS: audio arrives as chunks over WebSocket
        this._unsubTTSAudio = (this._tts as ElevenLabsTTS).onAudio(
          (event: TTSAudioEvent) => {
            this._handleTTSAudio(event, done);
          },
        );
        (this._tts as ElevenLabsTTS).speak(text);
        (this._tts as ElevenLabsTTS).flush();
      }
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // stopSpeaking() — barge-in
  // ────────────────────────────────────────────────────────────────────

  /** Stop current TTS playback immediately (barge-in). */
  stopSpeaking(): void {
    if (this._destroyed) return;

    this._log('stopSpeaking() — barge-in');

    // Stop all active AudioBufferSourceNodes
    for (const node of this._activeSourceNodes) {
      try {
        node.stop();
        node.disconnect();
      } catch {
        // Node may already be stopped
      }
    }
    this._activeSourceNodes.clear();
    this._lastScheduledSource = null;

    // Clear jitter buffer
    if (this._jitterBufferTimer !== null) {
      clearTimeout(this._jitterBufferTimer);
      this._jitterBufferTimer = null;
    }
    this._playbackQueue = [];
    this._isPlaybackStarted = false;

    // Abort pending LLM request
    if (this._pendingLLMAbort) {
      this._pendingLLMAbort.abort();
      this._pendingLLMAbort = null;
    }

    // Stop Web Speech TTS playback or close ElevenLabs TTS connection
    if (this._tts instanceof WebSpeechTTS) {
      this._tts.stop();
    } else if (this._tts?.isConnected) {
      this._tts.close();
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // onStateChange()
  // ────────────────────────────────────────────────────────────────────

  /** Subscribe to state changes. Returns an unsubscribe function. */
  onStateChange(callback: (state: VoiceState, previous: VoiceState) => void): () => void {
    this._stateChangeCallbacks.add(callback);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this._stateChangeCallbacks.delete(callback);
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // onTranscript()
  // ────────────────────────────────────────────────────────────────────

  /** Subscribe to transcript events. Returns an unsubscribe function. */
  onTranscript(callback: (text: string, isFinal: boolean) => void): () => void {
    this._transcriptCallbacks.add(callback);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this._transcriptCallbacks.delete(callback);
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // destroy()
  // ────────────────────────────────────────────────────────────────────

  /** Destroy all resources held by the pipeline. */
  async destroy(): Promise<void> {
    if (this._destroyed) return;
    this._destroyed = true;
    this._log('Destroying...');

    // Stop everything
    this.stopSpeaking();
    this.stopListening();

    // Tear down subscriptions
    this._unsubVADSpeechStart?.();
    this._unsubVADSpeechEnd?.();
    this._unsubSTTTranscript?.();
    this._unsubTTSAudio?.();
    this._unsubVADSpeechStart = null;
    this._unsubVADSpeechEnd = null;
    this._unsubSTTTranscript = null;
    this._unsubTTSAudio = null;

    // Destroy subsystems
    if (this._vad) {
      try {
        await this._vad.destroy();
      } catch {
        // Ignore VAD destroy errors
      }
      this._vad = null;
    }

    if (this._stt) {
      this._stt.destroy();
      this._stt = null;
    }

    if (this._tts) {
      this._tts.destroy();
      this._tts = null;
    }

    // Close AudioContext
    if (this._audioContext) {
      try {
        await this._audioContext.close();
      } catch {
        // Ignore close errors
      }
      this._audioContext = null;
    }

    // Clean up mic tracks
    this._stopMicTracks();

    // Clear callbacks
    this._stateChangeCallbacks.clear();
    this._transcriptCallbacks.clear();
    this._bus.removeAll();

    this._log('Destroyed');
  }

  // ════════════════════════════════════════════════════════════════════
  // PRIVATE: State machine
  // ════════════════════════════════════════════════════════════════════

  private _setState(next: VoiceState): void {
    const prev = this._state;
    if (prev === next) return;

    this._state = next;
    this._log(`State: ${prev} -> ${next}`);

    // Emit on internal bus
    this._bus.emit('voice:state-change', { from: prev, to: next });

    // Notify external subscribers
    for (const cb of this._stateChangeCallbacks) {
      try {
        cb(next, prev);
      } catch (err) {
        console.error(LOG_PREFIX, 'State change callback threw:', err);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // PRIVATE: AudioContext helpers
  // ════════════════════════════════════════════════════════════════════

  /**
   * Resolve the AudioContext constructor, with Safari webkitAudioContext
   * fallback. Returns null if Web Audio is not available.
   */
  private _resolveAudioContext(): typeof AudioContext | null {
    if (typeof AudioContext !== 'undefined') {
      return AudioContext;
    }
    if (typeof globalThis.webkitAudioContext !== 'undefined') {
      return globalThis.webkitAudioContext;
    }
    return null;
  }

  /**
   * Pre-warm the AudioContext by playing a silent buffer.
   * This forces the context into the "running" state and avoids a
   * noticeable delay on the first real playback.
   */
  private _prewarmAudioContext(ctx: AudioContext): void {
    try {
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      this._log('AudioContext pre-warmed');
    } catch {
      // Non-critical — ignore
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // PRIVATE: Mic capture → STT forwarding
  // ════════════════════════════════════════════════════════════════════

  /**
   * Set up a ScriptProcessorNode to capture mic audio and forward it
   * to the STT adapter when `_isForwardingToSTT` is true.
   */
  private _setupMicCapture(): void {
    if (!this._audioContext || !this._mediaStream || !this._stt) return;

    this._micSourceNode = this._audioContext.createMediaStreamSource(this._mediaStream);

    // Buffer size of 4096 at 48 kHz ≈ 85 ms of audio per callback
    const bufferSize = 4096;
    this._captureProcessor = this._audioContext.createScriptProcessor(bufferSize, 1, 1);

    this._captureProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
      if (!this._isForwardingToSTT || !this._stt) return;

      const inputData = event.inputBuffer.getChannelData(0);
      // DeepgramSTT.sendAudio accepts Float32Array and converts to Int16 internally
      this._stt.sendAudio(new Float32Array(inputData));
    };

    this._micSourceNode.connect(this._captureProcessor);
    // ScriptProcessorNode requires connection to destination to fire events
    this._captureProcessor.connect(this._audioContext.destination);
    this._log('Mic capture pipeline set up');
  }

  /** Tear down the mic capture ScriptProcessorNode. */
  private _teardownMicCapture(): void {
    if (this._captureProcessor) {
      try {
        this._captureProcessor.disconnect();
      } catch {
        // Ignore
      }
      this._captureProcessor.onaudioprocess = null;
      this._captureProcessor = null;
    }

    if (this._micSourceNode) {
      try {
        this._micSourceNode.disconnect();
      } catch {
        // Ignore
      }
      this._micSourceNode = null;
    }
  }

  /** Stop all tracks on the current MediaStream. */
  private _stopMicTracks(): void {
    if (this._mediaStream) {
      for (const track of this._mediaStream.getTracks()) {
        track.stop();
      }
      this._mediaStream = null;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // PRIVATE: VAD event handlers
  // ════════════════════════════════════════════════════════════════════

  private _handleVADSpeechStart(): void {
    this._log('VAD: speech-start, current state:', this._state);

    if (this._state === 'speaking') {
      // Barge-in: user is speaking while TTS is playing
      if (this._isEchoDetected()) {
        this._log('Echo detected — ignoring barge-in');
        return;
      }

      this._log('Barge-in detected');
      this.stopSpeaking();
      // Restart listening (we keep the mic stream alive)
      this._isForwardingToSTT = true;
      this._setState('listening');
      return;
    }

    if (this._state === 'listening') {
      // Start forwarding audio to STT
      this._isForwardingToSTT = true;
      this._log('Started forwarding audio to STT');
    }
  }

  private _handleVADSpeechEnd(): void {
    this._log('VAD: speech-end, current state:', this._state);

    if (this._state === 'listening') {
      // Stop forwarding to STT; we wait for a final transcript
      this._isForwardingToSTT = false;
      this._log('Stopped forwarding audio to STT');
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // PRIVATE: STT transcript handler
  // ════════════════════════════════════════════════════════════════════

  private _handleTranscript(event: STTTranscriptEvent): void {
    const { text, isFinal } = event;

    if (!text || !text.trim()) return;

    // Echo detection: discard transcripts that match recent TTS output
    if (isFinal && this._isTranscriptEcho(text)) {
      this._log('Echo detected — discarding transcript:', text);
      return;
    }

    // Notify external transcript subscribers
    this._bus.emit('voice:transcript', {
      text,
      isFinal,
      confidence: event.confidence,
    });

    for (const cb of this._transcriptCallbacks) {
      try {
        cb(text, isFinal);
      } catch (err) {
        console.error(LOG_PREFIX, 'Transcript callback threw:', err);
      }
    }

    // On final transcript while listening → transition to PROCESSING
    // (The actual LLM call is driven by the consumer calling processTranscript)
    if (isFinal && this._state === 'listening') {
      this._log('Final transcript received:', text);
      this._isForwardingToSTT = false;
      // Note: we do NOT transition to PROCESSING here. The consumer is
      // responsible for calling processTranscript() which sets the state.
      // This keeps the pipeline composable — consumers can decide to
      // ignore transcripts, batch them, etc.
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // PRIVATE: TTS audio playback
  // ════════════════════════════════════════════════════════════════════

  /**
   * Handle an audio chunk from ElevenLabs TTS.
   *
   * Implements a jitter buffer: we accumulate audio for JITTER_BUFFER_MS
   * before starting playback to smooth out network jitter.
   */
  private _handleTTSAudio(event: TTSAudioEvent, onDone: () => void): void {
    if (this._state !== 'speaking') {
      // State changed (e.g. barge-in) — discard audio
      return;
    }

    if (event.isFinal && event.audio.byteLength === 0) {
      // Final marker with no audio — flush whatever we have and finish
      this._flushJitterBuffer(onDone);
      return;
    }

    if (event.audio.byteLength === 0) return;

    // Add to jitter buffer queue
    this._playbackQueue.push(event.audio);

    if (!this._isPlaybackStarted) {
      // Start the jitter buffer timer on the first chunk
      if (this._jitterBufferTimer === null) {
        this._jitterBufferTimer = setTimeout(() => {
          this._jitterBufferTimer = null;
          this._startPlayback(event.isFinal ? onDone : undefined);
        }, JITTER_BUFFER_MS);
      }
    } else {
      // Playback already started — decode and schedule immediately
      this._decodeAndSchedule(event.audio, event.isFinal ? onDone : undefined);
    }

    if (event.isFinal) {
      // Clear the jitter buffer timer since we got the final chunk
      if (this._jitterBufferTimer !== null) {
        clearTimeout(this._jitterBufferTimer);
        this._jitterBufferTimer = null;
        this._startPlayback(onDone);
      }
    }
  }

  /** Flush the jitter buffer and start playback. */
  private _flushJitterBuffer(onDone: () => void): void {
    if (this._jitterBufferTimer !== null) {
      clearTimeout(this._jitterBufferTimer);
      this._jitterBufferTimer = null;
    }

    if (this._playbackQueue.length > 0) {
      this._startPlayback(onDone);
    } else {
      // No audio to play — done immediately
      onDone();
    }
  }

  /**
   * Begin playback: decode all queued chunks and schedule them.
   * If `onDone` is provided, it is called when the last chunk finishes playing.
   */
  private _startPlayback(onDone?: () => void): void {
    if (this._isPlaybackStarted) {
      // Already started — just flush the remaining queue
      if (this._playbackQueue.length > 0) {
        const remaining = this._playbackQueue.splice(0);
        const lastIdx = remaining.length - 1;
        for (let i = 0; i < remaining.length; i++) {
          this._decodeAndSchedule(
            remaining[i]!,
            i === lastIdx ? onDone : undefined,
          );
        }
      } else if (onDone) {
        // If there are active sources wait for the last one, otherwise call done now
        if (this._lastScheduledSource) {
          const prevOnEnded = this._lastScheduledSource.onended;
          this._lastScheduledSource.onended = () => {
            if (typeof prevOnEnded === 'function') {
              prevOnEnded.call(this._lastScheduledSource!, new Event('ended'));
            }
            onDone();
          };
        } else {
          onDone();
        }
      }
      return;
    }

    this._isPlaybackStarted = true;
    this._nextPlaybackTime = 0;

    const queued = this._playbackQueue.splice(0);
    const lastIdx = queued.length - 1;

    for (let i = 0; i < queued.length; i++) {
      this._decodeAndSchedule(
        queued[i]!,
        i === lastIdx ? onDone : undefined,
      );
    }
  }

  /**
   * Decode an audio chunk (mp3 from ElevenLabs) and schedule it for
   * sequential playback via AudioBufferSourceNode.
   */
  private _decodeAndSchedule(audioData: ArrayBuffer, onDone?: () => void): void {
    // Guard against multiple invocations of onDone. This can happen when
    // multiple pending decode operations reference the same callback, or
    // when both the success and error paths fire (e.g. state change
    // during decode).
    let onDoneCalled = false;
    const safeOnDone = onDone
      ? () => {
          if (onDoneCalled) return;
          onDoneCalled = true;
          onDone();
        }
      : undefined;

    if (!this._audioContext || this._state !== 'speaking') {
      safeOnDone?.();
      return;
    }

    const ctx = this._audioContext;

    // decodeAudioData needs a copy because it detaches the ArrayBuffer
    const copy = audioData.slice(0);

    ctx.decodeAudioData(
      copy,
      (decodedBuffer) => {
        if (this._state !== 'speaking' || !this._audioContext) {
          safeOnDone?.();
          return;
        }

        const source = ctx.createBufferSource();
        source.buffer = decodedBuffer;
        source.connect(ctx.destination);

        // Track active sources for barge-in cleanup
        this._activeSourceNodes.add(source);
        this._lastScheduledSource = source;

        source.onended = () => {
          this._activeSourceNodes.delete(source);
          if (this._lastScheduledSource === source) {
            this._lastScheduledSource = null;
          }

          // If this was the last source and we have onDone, call it
          if (safeOnDone) {
            safeOnDone();
          }
        };

        // Schedule playback sequentially
        const now = ctx.currentTime;
        const startTime = Math.max(now, this._nextPlaybackTime);
        source.start(startTime);
        this._nextPlaybackTime = startTime + decodedBuffer.duration;

        this._log(
          'Scheduled audio chunk:',
          decodedBuffer.duration.toFixed(3) + 's',
          'at',
          startTime.toFixed(3),
        );
      },
      (err) => {
        this._log('Failed to decode audio chunk:', err);
        safeOnDone?.();
      },
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // PRIVATE: Echo detection
  // ════════════════════════════════════════════════════════════════════

  /**
   * Check if VAD speech-start during SPEAKING state is likely echo from
   * the speaker playing TTS audio rather than genuine user speech.
   *
   * Simple heuristic: if we are still within the echo window of a recent
   * TTS utterance, treat it as potential echo.
   */
  private _isEchoDetected(): boolean {
    if (!this._lastTTSEcho) return false;
    const elapsed = Date.now() - this._lastTTSEcho.timestamp;
    // During active TTS playback, suppress barge-in only if within window
    // and the speaker is still audibly outputting. We use the echo window
    // as a conservative guard.
    return elapsed < ECHO_WINDOW_MS;
  }

  /**
   * Check if a transcript is an echo of recent TTS output.
   *
   * Uses word overlap: if intersection of words > 60% of max set size
   * and the transcript arrived within the echo window, discard it.
   */
  private _isTranscriptEcho(transcript: string): boolean {
    if (!this._lastTTSEcho) return false;

    const elapsed = Date.now() - this._lastTTSEcho.timestamp;
    if (elapsed > ECHO_WINDOW_MS) return false;

    const transcriptWords = new Set(this._normalizeWords(transcript));
    const ttsWords = this._lastTTSEcho.words;

    if (transcriptWords.size === 0 || ttsWords.size === 0) return false;

    // Compute intersection
    let intersectionCount = 0;
    for (const word of transcriptWords) {
      if (ttsWords.has(word)) {
        intersectionCount++;
      }
    }

    const maxSize = Math.max(transcriptWords.size, ttsWords.size);
    const overlap = intersectionCount / maxSize;

    this._log(
      'Echo check: overlap =',
      (overlap * 100).toFixed(1) + '%,',
      'threshold =',
      (ECHO_OVERLAP_THRESHOLD * 100).toFixed(1) + '%',
    );

    return overlap >= ECHO_OVERLAP_THRESHOLD;
  }

  /**
   * Normalize text into a set of lowercase words, stripping punctuation.
   */
  private _normalizeWords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 0);
  }

  // ════════════════════════════════════════════════════════════════════
  // PRIVATE: Logging
  // ════════════════════════════════════════════════════════════════════

  private _log(...args: unknown[]): void {
    if (this._debug) {
      console.debug(LOG_PREFIX, ...args);
    }
  }
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { WebSocketManager } from './websocket-manager.js';
export type { WSState, WebSocketManagerOptions } from './websocket-manager.js';
export { DeepgramSTT } from './deepgram-stt.js';
export type { DeepgramSTTOptions, STTTranscriptEvent } from './deepgram-stt.js';
export { ElevenLabsSTT } from './elevenlabs-stt.js';
export type { ElevenLabsSTTOptions } from './elevenlabs-stt.js';
export { ElevenLabsTTS } from './elevenlabs-tts.js';
export type { ElevenLabsTTSOptions, TTSAudioEvent } from './elevenlabs-tts.js';
export { WebSpeechSTT } from './web-speech-stt.js';
export type { WebSpeechSTTOptions } from './web-speech-stt.js';
export { WebSpeechTTS } from './web-speech-tts.js';
export type { WebSpeechTTSOptions, WebSpeechTTSAudioEvent } from './web-speech-tts.js';
