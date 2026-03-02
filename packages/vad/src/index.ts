// @guidekit/vad — Silero VAD ONNX model wrapper for voice activity detection
import * as ort from 'onnxruntime-web';

export const VAD_VERSION = '0.1.0-beta.2';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[GuideKit:VAD]';

/** Default CDN URL for the Silero VAD ONNX model (v5). */
const DEFAULT_MODEL_URL =
  'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.20/dist/silero_vad_v5.onnx';

/** Cache API key used for persisting the downloaded ONNX model. */
const CACHE_NAME = `guidekit-vad-v${VAD_VERSION}`;
const CACHE_MODEL_KEY = 'model.onnx';

/** Silero VAD frame size: 512 samples at 16 kHz = 32 ms per frame. */
const FRAME_SIZE = 512;

/** Target sample rate for VAD processing. */
const TARGET_SAMPLE_RATE = 16000;

/** Duration (in ms) of audio collected for noise floor calibration. */
const CALIBRATION_DURATION_MS = 500;

/** Hidden/cell state size for Silero VAD v5 LSTM. */
const STATE_SIZE = 128;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VADOptions {
  /** Speech probability threshold (0-1). Default: 0.5 */
  threshold?: number;
  /** Minimum speech duration in ms to trigger start. Default: 300 */
  minSpeechDurationMs?: number;
  /** Silence duration in ms after speech to trigger end. Default: 500 */
  silenceDurationMs?: number;
  /** Sample rate. Default: 16000 */
  sampleRate?: number;
  /** Enable debug logging. Default: false */
  debug?: boolean;
  /** Custom URL for the Silero VAD ONNX model file. */
  modelUrl?: string;
}

export interface VADEvent {
  type: 'speech-start' | 'speech-end' | 'vad-ready';
  timestamp: number;
  /** Speech probability (0-1) at the moment of the event. */
  probability?: number;
}

type VADEventType = VADEvent['type'];
type VADCallback = (event: VADEvent) => void;

// ---------------------------------------------------------------------------
// Utility: Cache API helpers
// ---------------------------------------------------------------------------

async function loadModelFromCache(): Promise<ArrayBuffer | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(CACHE_MODEL_KEY);
    return response ? response.arrayBuffer() : null;
  } catch {
    // Cache API may be unavailable in certain contexts (e.g. opaque origins).
    return null;
  }
}

async function saveModelToCache(data: ArrayBuffer): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(CACHE_MODEL_KEY, new Response(data));
  } catch {
    // Silently ignore cache write failures.
  }
}

// ---------------------------------------------------------------------------
// Utility: Resampler
// ---------------------------------------------------------------------------

/**
 * Simple linear-interpolation resampler from `inputRate` to `outputRate`.
 * Adequate for VAD where perceptual audio quality is irrelevant.
 */
function resample(
  input: Float32Array,
  inputRate: number,
  outputRate: number,
): Float32Array {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const srcFloor = Math.floor(srcIndex);
    const srcCeil = Math.min(srcFloor + 1, input.length - 1);
    const frac = srcIndex - srcFloor;
    output[i] = (input[srcFloor] as number) * (1 - frac) + (input[srcCeil] as number) * frac;
  }
  return output;
}

// ---------------------------------------------------------------------------
// SileroVAD
// ---------------------------------------------------------------------------

export class SileroVAD {
  // Options (resolved with defaults)
  private readonly _threshold: number;
  private readonly _minSpeechDurationMs: number;
  private readonly _silenceDurationMs: number;
  private readonly _sampleRate: number;
  private readonly _debug: boolean;
  private readonly _modelUrl: string;

  // ONNX Runtime state
  private _session: ort.InferenceSession | null = null;
  private _h: ort.Tensor | null = null;
  private _c: ort.Tensor | null = null;

  // Audio pipeline
  private _audioContext: AudioContext | null = null;
  private _ownsAudioContext = false;
  private _sourceNode: MediaStreamAudioSourceNode | null = null;
  private _workletNode: AudioWorkletNode | ScriptProcessorNode | null = null;
  private _stream: MediaStream | null = null;

  // Frame buffer for accumulating resampled samples into FRAME_SIZE chunks
  private _frameBuffer: Float32Array = new Float32Array(0);
  private _frameBufferOffset = 0;

  // State tracking
  private _isReady = false;
  private _isSpeaking = false;
  private _isStarted = false;
  private _isDestroyed = false;

  // Duration tracking (in frames)
  private _consecutiveSpeechFrames = 0;
  private _consecutiveSilenceFrames = 0;
  private _frameDurationMs: number;
  private _minSpeechFrames: number;
  private _silenceFrames: number;

  // Noise floor calibration
  private _isCalibrating = false;
  private _calibrationSamples: number[] = [];
  private _calibrationFramesNeeded = 0;
  private _calibratedThreshold: number;

  // Event listeners
  private _listeners: Map<VADEventType, Set<VADCallback>> = new Map();

  // Processing lock to serialise frame inference
  private _processingPromise: Promise<void> = Promise.resolve();

  constructor(options?: VADOptions) {
    this._threshold = options?.threshold ?? 0.5;
    this._minSpeechDurationMs = options?.minSpeechDurationMs ?? 300;
    this._silenceDurationMs = options?.silenceDurationMs ?? 500;
    this._sampleRate = options?.sampleRate ?? TARGET_SAMPLE_RATE;
    this._debug = options?.debug ?? false;
    this._modelUrl = options?.modelUrl ?? DEFAULT_MODEL_URL;
    this._calibratedThreshold = this._threshold;

    // Pre-compute frame-duration-based counters
    this._frameDurationMs = (FRAME_SIZE / this._sampleRate) * 1000;
    this._minSpeechFrames = Math.ceil(this._minSpeechDurationMs / this._frameDurationMs);
    this._silenceFrames = Math.ceil(this._silenceDurationMs / this._frameDurationMs);

    this._log('Created with options', {
      threshold: this._threshold,
      minSpeechDurationMs: this._minSpeechDurationMs,
      silenceDurationMs: this._silenceDurationMs,
      sampleRate: this._sampleRate,
      modelUrl: this._modelUrl,
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Load the ONNX model. Uses Cache API for persistence across sessions. */
  async init(): Promise<void> {
    if (this._isDestroyed) {
      throw new Error(`${LOG_PREFIX} Cannot init after destroy`);
    }
    if (this._isReady) {
      this._log('Already initialised — skipping');
      return;
    }

    this._log('Initialising...');

    // 1. Attempt to load model bytes from cache, falling back to network.
    let modelBuffer = await loadModelFromCache();
    if (modelBuffer) {
      this._log('Loaded model from Cache API');
    } else {
      this._log('Fetching model from', this._modelUrl);
      const response = await fetch(this._modelUrl);
      if (!response.ok) {
        throw new Error(
          `${LOG_PREFIX} Failed to fetch model: ${response.status} ${response.statusText}`,
        );
      }
      modelBuffer = await response.arrayBuffer();
      this._log('Model fetched, size:', modelBuffer.byteLength, 'bytes');

      // Persist to Cache API for next time.
      await saveModelToCache(modelBuffer);
      this._log('Model saved to Cache API');
    }

    // 2. Create ONNX InferenceSession.
    this._session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    // 3. Initialise LSTM hidden/cell state tensors (zeros).
    this._resetStates();

    this._isReady = true;
    this._log('Model loaded and ready');

    this._emit({
      type: 'vad-ready',
      timestamp: Date.now(),
    });
  }

  /**
   * Process a single audio frame (512 samples at 16 kHz).
   * Returns the speech probability (0-1).
   */
  async processFrame(audioData: Float32Array): Promise<number> {
    if (!this._session) {
      throw new Error(`${LOG_PREFIX} Model not loaded. Call init() first.`);
    }
    if (audioData.length !== FRAME_SIZE) {
      throw new Error(
        `${LOG_PREFIX} Expected ${FRAME_SIZE} samples, got ${audioData.length}`,
      );
    }

    const inputTensor = new ort.Tensor('float32', audioData, [1, FRAME_SIZE]);
    const srTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(this._sampleRate)]), [1]);

    const feeds: Record<string, ort.Tensor> = {
      input: inputTensor,
      sr: srTensor,
      h: this._h!,
      c: this._c!,
    };

    const results = await this._session.run(feeds);

    // Update LSTM hidden/cell states for the next frame.
    this._h = results['hn'] as ort.Tensor;
    this._c = results['cn'] as ort.Tensor;

    const probability = (results['output'] as ort.Tensor).data[0] as number;
    return probability;
  }

  /** Start VAD processing on a MediaStream (typically from getUserMedia). */
  start(stream: MediaStream): void {
    if (this._isDestroyed) {
      throw new Error(`${LOG_PREFIX} Cannot start after destroy`);
    }
    if (!this._isReady) {
      throw new Error(`${LOG_PREFIX} Model not loaded. Call init() first.`);
    }
    if (this._isStarted) {
      this._log('Already started — stopping previous session first');
      this.stop();
    }

    this._log('Starting VAD on MediaStream');
    this._stream = stream;
    this._isStarted = true;

    // Reset speech tracking state.
    this._isSpeaking = false;
    this._consecutiveSpeechFrames = 0;
    this._consecutiveSilenceFrames = 0;
    this._frameBuffer = new Float32Array(FRAME_SIZE);
    this._frameBufferOffset = 0;

    // Reset LSTM states for a fresh stream.
    this._resetStates();

    // Begin noise floor calibration.
    this._isCalibrating = true;
    this._calibrationSamples = [];
    this._calibrationFramesNeeded = Math.max(1, Math.floor(
      (CALIBRATION_DURATION_MS / 1000) * this._sampleRate / FRAME_SIZE,
    ));
    this._log('Calibrating noise floor for', this._calibrationFramesNeeded, 'frames');

    // Build the audio processing pipeline.
    this._setupAudioPipeline(stream);
  }

  /** Stop VAD processing and release audio resources (but keep the model). */
  stop(): void {
    if (!this._isStarted) return;

    this._log('Stopping VAD');

    // Tear down audio nodes.
    this._teardownAudioPipeline();

    // If we were speaking, emit speech-end.
    if (this._isSpeaking) {
      this._isSpeaking = false;
      this._emit({
        type: 'speech-end',
        timestamp: Date.now(),
        probability: 0,
      });
    }

    // Reset state.
    this._isStarted = false;
    this._isSpeaking = false;
    this._consecutiveSpeechFrames = 0;
    this._consecutiveSilenceFrames = 0;
    this._frameBufferOffset = 0;
    this._isCalibrating = false;
    this._calibrationSamples = [];
    this._processingPromise = Promise.resolve();

    this._log('VAD stopped');
  }

  /** Register a callback for speech-start events. Returns an unsubscribe function. */
  onSpeechStart(callback: VADCallback): () => void {
    return this._on('speech-start', callback);
  }

  /** Register a callback for speech-end events. Returns an unsubscribe function. */
  onSpeechEnd(callback: VADCallback): () => void {
    return this._on('speech-end', callback);
  }

  /** Register a callback for vad-ready events. Returns an unsubscribe function. */
  onReady(callback: VADCallback): () => void {
    return this._on('vad-ready', callback);
  }

  /** Whether the ONNX model is loaded and ready. */
  get isReady(): boolean {
    return this._isReady;
  }

  /** Whether speech is currently detected. */
  get isSpeaking(): boolean {
    return this._isSpeaking;
  }

  /** The MediaStream currently being processed, or null. */
  get stream(): MediaStream | null {
    return this._stream;
  }

  /** Release ONNX model session and all audio resources. */
  async destroy(): Promise<void> {
    if (this._isDestroyed) return;
    this._log('Destroying...');

    this.stop();

    if (this._session) {
      await this._session.release();
      this._session = null;
    }

    // Dispose tensors.
    this._h?.dispose();
    this._c?.dispose();
    this._h = null;
    this._c = null;

    this._isReady = false;
    this._isDestroyed = true;
    this._listeners.clear();

    this._log('Destroyed');
  }

  // -------------------------------------------------------------------------
  // Private: Event system
  // -------------------------------------------------------------------------

  private _on(type: VADEventType, callback: VADCallback): () => void {
    let set = this._listeners.get(type);
    if (!set) {
      set = new Set();
      this._listeners.set(type, set);
    }
    set.add(callback);
    return () => {
      set!.delete(callback);
    };
  }

  private _emit(event: VADEvent): void {
    const set = this._listeners.get(event.type);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`${LOG_PREFIX} Error in ${event.type} callback:`, err);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private: Audio pipeline
  // -------------------------------------------------------------------------

  private _setupAudioPipeline(stream: MediaStream): void {
    // Determine the incoming sample rate.
    const tracks = stream.getAudioTracks();
    const trackSettings = tracks[0]?.getSettings();
    const inputSampleRate = trackSettings?.sampleRate ?? 48000;

    this._log('Input sample rate:', inputSampleRate);

    // Create AudioContext at the input sample rate so we don't double-resample.
    // SSR guard: AudioContext may not exist.
    if (typeof AudioContext === 'undefined' && typeof webkitAudioContext === 'undefined') {
      throw new Error(`${LOG_PREFIX} AudioContext is not available in this environment`);
    }

    const AudioContextClass =
      typeof AudioContext !== 'undefined'
        ? AudioContext
        : // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).webkitAudioContext as typeof AudioContext;

    this._audioContext = new AudioContextClass({ sampleRate: inputSampleRate });
    this._ownsAudioContext = true;

    this._sourceNode = this._audioContext.createMediaStreamSource(stream);

    // Try AudioWorklet first, fall back to ScriptProcessorNode.
    this._setupScriptProcessor(inputSampleRate);
  }

  /**
   * ScriptProcessorNode fallback (works everywhere, including Safari).
   * We use a buffer size of 4096 which gives ~85 ms of audio at 48 kHz.
   */
  private _setupScriptProcessor(inputSampleRate: number): void {
    if (!this._audioContext || !this._sourceNode) return;

    // Buffer size must be a power of 2: 256, 512, 1024, 2048, 4096, 8192, 16384.
    const bufferSize = 4096;
    const processor = this._audioContext.createScriptProcessor(bufferSize, 1, 1);

    processor.onaudioprocess = (event: AudioProcessingEvent) => {
      if (!this._isStarted) return;

      const inputData = event.inputBuffer.getChannelData(0);

      // Resample to target rate if needed.
      const resampled =
        inputSampleRate !== this._sampleRate
          ? resample(inputData, inputSampleRate, this._sampleRate)
          : new Float32Array(inputData);

      // Feed resampled audio into frame-sized chunks.
      this._feedAudio(resampled);
    };

    this._sourceNode.connect(processor);
    processor.connect(this._audioContext.destination);
    this._workletNode = processor;

    this._log('Audio pipeline set up (ScriptProcessorNode)');
  }

  /**
   * Accumulate resampled audio into FRAME_SIZE chunks and process each full frame.
   */
  private _feedAudio(samples: Float32Array): void {
    let offset = 0;

    while (offset < samples.length) {
      const remaining = FRAME_SIZE - this._frameBufferOffset;
      const available = samples.length - offset;
      const toCopy = Math.min(remaining, available);

      this._frameBuffer.set(
        samples.subarray(offset, offset + toCopy),
        this._frameBufferOffset,
      );
      this._frameBufferOffset += toCopy;
      offset += toCopy;

      if (this._frameBufferOffset === FRAME_SIZE) {
        const frame = new Float32Array(this._frameBuffer);
        this._frameBufferOffset = 0;

        // Serialise inference calls to avoid overlapping ONNX sessions.
        this._processingPromise = this._processingPromise.then(() =>
          this._handleFrame(frame),
        );
      }
    }
  }

  /**
   * Process a single FRAME_SIZE frame: run inference and update speech state.
   */
  private async _handleFrame(frame: Float32Array): Promise<void> {
    if (!this._isStarted || !this._session) return;

    let probability: number;
    try {
      probability = await this.processFrame(frame);
    } catch (err) {
      if (this._debug) {
        // eslint-disable-next-line no-console
        console.error(`${LOG_PREFIX} Inference error:`, err);
      }
      return;
    }

    // Noise floor calibration phase.
    if (this._isCalibrating) {
      this._calibrationSamples.push(probability);

      if (this._calibrationSamples.length >= this._calibrationFramesNeeded) {
        this._finishCalibration();
      }
      return;
    }

    // Speech state machine.
    const isSpeechFrame = probability >= this._calibratedThreshold;

    if (isSpeechFrame) {
      this._consecutiveSpeechFrames++;
      this._consecutiveSilenceFrames = 0;

      if (!this._isSpeaking && this._consecutiveSpeechFrames >= this._minSpeechFrames) {
        this._isSpeaking = true;
        this._log('Speech started, probability:', probability.toFixed(3));
        this._emit({
          type: 'speech-start',
          timestamp: Date.now(),
          probability,
        });
      }
    } else {
      this._consecutiveSilenceFrames++;
      // Do NOT reset _consecutiveSpeechFrames here — only reset when speech-end fires.

      if (this._isSpeaking && this._consecutiveSilenceFrames >= this._silenceFrames) {
        this._isSpeaking = false;
        this._consecutiveSpeechFrames = 0;
        this._log('Speech ended, probability:', probability.toFixed(3));
        this._emit({
          type: 'speech-end',
          timestamp: Date.now(),
          probability,
        });
      }
    }
  }

  private _finishCalibration(): void {
    if (this._calibrationSamples.length === 0) {
      this._isCalibrating = false;
      return;
    }

    // Compute average noise floor probability.
    const sum = this._calibrationSamples.reduce((a, b) => a + b, 0);
    const avgNoise = sum / this._calibrationSamples.length;

    // If the ambient noise floor is high, nudge the threshold above it.
    // We add a margin so we don't constantly trigger on background noise.
    const NOISE_MARGIN = 0.15;
    if (avgNoise + NOISE_MARGIN > this._threshold) {
      this._calibratedThreshold = Math.min(avgNoise + NOISE_MARGIN, 0.95);
      this._log(
        'Noise floor is high. Adjusted threshold from',
        this._threshold.toFixed(3),
        'to',
        this._calibratedThreshold.toFixed(3),
        '(avg noise:',
        avgNoise.toFixed(3) + ')',
      );
    } else {
      this._calibratedThreshold = this._threshold;
      this._log('Noise floor OK, avg:', avgNoise.toFixed(3), '— keeping threshold at', this._threshold.toFixed(3));
    }

    // Recompute frame counters in case threshold changed min speech behaviour.
    this._minSpeechFrames = Math.ceil(this._minSpeechDurationMs / this._frameDurationMs);
    this._silenceFrames = Math.ceil(this._silenceDurationMs / this._frameDurationMs);

    this._isCalibrating = false;
    this._calibrationSamples = [];
  }

  private _teardownAudioPipeline(): void {
    if (this._workletNode) {
      try {
        this._workletNode.disconnect();
      } catch {
        // Ignore disconnect errors.
      }
      if ('onaudioprocess' in this._workletNode) {
        (this._workletNode as ScriptProcessorNode).onaudioprocess = null;
      }
      this._workletNode = null;
    }

    if (this._sourceNode) {
      try {
        this._sourceNode.disconnect();
      } catch {
        // Ignore.
      }
      this._sourceNode = null;
    }

    if (this._audioContext && this._ownsAudioContext) {
      try {
        void this._audioContext.close();
      } catch {
        // Ignore.
      }
      this._audioContext = null;
      this._ownsAudioContext = false;
    }

    this._stream = null;
  }

  // -------------------------------------------------------------------------
  // Private: ONNX state helpers
  // -------------------------------------------------------------------------

  /** Reset the LSTM hidden and cell states to zeros. */
  private _resetStates(): void {
    // Dispose any existing tensors to free memory.
    this._h?.dispose();
    this._c?.dispose();

    const zeros = new Float32Array(2 * STATE_SIZE).fill(0);
    this._h = new ort.Tensor('float32', zeros.slice(0, STATE_SIZE), [2, 1, 64]);
    this._c = new ort.Tensor('float32', zeros.slice(STATE_SIZE), [2, 1, 64]);
  }

  // -------------------------------------------------------------------------
  // Private: Logging
  // -------------------------------------------------------------------------

  private _log(...args: unknown[]): void {
    if (!this._debug) return;
    // eslint-disable-next-line no-console
    console.log(LOG_PREFIX, ...args);
  }
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

/**
 * Create and initialise a SileroVAD instance in one call.
 *
 * ```ts
 * const vad = await createVAD({ debug: true });
 * vad.onSpeechStart(() => console.log('speaking'));
 * vad.start(stream);
 * ```
 */
export async function createVAD(options?: VADOptions): Promise<SileroVAD> {
  const vad = new SileroVAD(options);
  await vad.init();
  return vad;
}

// Re-export the frame size constant so consumers can align their buffers.
export { FRAME_SIZE, TARGET_SAMPLE_RATE };

// Type-only declaration for environments that provide webkitAudioContext.
declare global {
  // eslint-disable-next-line no-var
  var webkitAudioContext: typeof AudioContext | undefined;
}
