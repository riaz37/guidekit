// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock: onnxruntime-web
// ---------------------------------------------------------------------------
// vi.mock is hoisted above imports, so mock variables must be declared via
// vi.hoisted() to be available inside the factory.

const { mockRelease, mockDispose, mockRun, mockSessionCreate } = vi.hoisted(() => {
  const mockDispose = vi.fn();
  const mockRelease = vi.fn().mockResolvedValue(undefined);
  const mockRun = vi.fn().mockResolvedValue({
    output: { data: [0.1] },
    stateN: { data: new Float32Array(256).fill(0), dispose: mockDispose },
  });
  const mockSessionCreate = vi.fn().mockResolvedValue({
    run: mockRun,
    release: mockRelease,
  });
  return { mockRelease, mockDispose, mockRun, mockSessionCreate };
});

vi.mock('onnxruntime-web', () => {
  const TensorClass = vi.fn().mockImplementation(
    (type: string, data: ArrayLike<number> | BigInt64Array, dims?: number[]) => ({
      type,
      data,
      dims: dims ?? [],
      dispose: mockDispose,
    }),
  );

  return {
    InferenceSession: {
      create: mockSessionCreate,
    },
    Tensor: TensorClass,
    env: { logLevel: 'error' },
  };
});

// ---------------------------------------------------------------------------
// Mock: Cache API (Map-backed)
// ---------------------------------------------------------------------------

function createMockCacheStorage(): CacheStorage {
  const stores = new Map<string, Map<string, Response>>();

  return {
    open: vi.fn(async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        match: vi.fn(async (key: string) => store.get(key) ?? undefined),
        put: vi.fn(async (key: string, response: Response) => {
          store.set(key, response);
        }),
        delete: vi.fn(async (key: string) => store.delete(key)),
        add: vi.fn(),
        addAll: vi.fn(),
        keys: vi.fn(async () => []),
        matchAll: vi.fn(async () => []),
      } as unknown as Cache;
    }),
    has: vi.fn(async (name: string) => stores.has(name)),
    delete: vi.fn(async (name: string) => stores.delete(name)),
    keys: vi.fn(async () => [...stores.keys()]),
    match: vi.fn(async () => undefined),
  };
}

// ---------------------------------------------------------------------------
// Mock: fetch
// ---------------------------------------------------------------------------

const modelBytes = new ArrayBuffer(1024);

const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  statusText: 'OK',
  arrayBuffer: vi.fn().mockResolvedValue(modelBytes),
});

// ---------------------------------------------------------------------------
// Mock: AudioContext / MediaStream / ScriptProcessorNode
// ---------------------------------------------------------------------------

function createMockMediaStream(): MediaStream {
  return {
    getAudioTracks: vi.fn(() => [
      {
        getSettings: vi.fn(() => ({ sampleRate: 48000 })),
        stop: vi.fn(),
      },
    ]),
    getTracks: vi.fn(() => []),
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    clone: vi.fn(),
    id: 'mock-stream',
    active: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    getVideoTracks: vi.fn(() => []),
    onaddtrack: null,
    onremovetrack: null,
  } as unknown as MediaStream;
}

function createMockScriptProcessorNode(): ScriptProcessorNode {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onaudioprocess: null,
    bufferSize: 4096,
    numberOfInputs: 1,
    numberOfOutputs: 1,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    channelCount: 1,
    channelCountMode: 'max',
    channelInterpretation: 'speakers',
    context: {} as AudioContext,
  } as unknown as ScriptProcessorNode;
}

function createMockAudioContext(): AudioContext {
  const processorNode = createMockScriptProcessorNode();

  return {
    createMediaStreamSource: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      mediaStream: {} as MediaStream,
      channelCount: 1,
      channelCountMode: 'max',
      channelInterpretation: 'speakers',
      context: {} as AudioContext,
      numberOfInputs: 0,
      numberOfOutputs: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
    createScriptProcessor: vi.fn(() => processorNode),
    destination: {} as AudioDestinationNode,
    close: vi.fn().mockResolvedValue(undefined),
    sampleRate: 48000,
    state: 'running',
    currentTime: 0,
    listener: {} as AudioListener,
    baseLatency: 0,
    outputLatency: 0,
    audioWorklet: {} as AudioWorklet,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    // Expose the processor node for test access
    _processorNode: processorNode,
  } as unknown as AudioContext & { _processorNode: ScriptProcessorNode };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let AudioContextSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();

  // Install mocks on globalThis
  Object.defineProperty(globalThis, 'caches', {
    value: createMockCacheStorage(),
    writable: true,
    configurable: true,
  });

  globalThis.fetch = mockFetch as unknown as typeof fetch;

  AudioContextSpy = vi.fn(() => createMockAudioContext());
  Object.defineProperty(globalThis, 'AudioContext', {
    value: AudioContextSpy,
    writable: true,
    configurable: true,
  });

  // Reset default mock responses
  mockRun.mockResolvedValue({
    output: { data: [0.1] },
    stateN: { data: new Float32Array(256).fill(0), dispose: mockDispose },
  });

  // Re-establish default fetch mock (may have been overridden by individual tests)
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: vi.fn().mockResolvedValue(modelBytes),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Import under test (after mocks are set up)
// ---------------------------------------------------------------------------

import { SileroVAD, createVAD, FRAME_SIZE, TARGET_SAMPLE_RATE } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a valid 512-sample frame of audio data. */
function makeFrame(value = 0.0): Float32Array {
  return new Float32Array(FRAME_SIZE).fill(value);
}

/** Initialise a VAD instance (model loaded, ready). */
async function createReadyVAD(options?: ConstructorParameters<typeof SileroVAD>[0]) {
  const vad = new SileroVAD(options);
  await vad.init();
  return vad;
}

// ===========================================================================
// Test Suites
// ===========================================================================

describe('SileroVAD', () => {
  // =========================================================================
  // 1. Constructor
  // =========================================================================
  describe('Constructor', () => {
    it('should use default options when none provided', () => {
      const vad = new SileroVAD();
      expect(vad.isReady).toBe(false);
      expect(vad.isSpeaking).toBe(false);
      expect(vad.stream).toBeNull();
    });

    it('should accept custom thresholds', () => {
      const vad = new SileroVAD({
        threshold: 0.7,
        minSpeechDurationMs: 200,
        silenceDurationMs: 400,
        sampleRate: 16000,
        debug: true,
      });
      // We can only verify indirectly via the public API.
      // The instance should be constructible without error.
      expect(vad).toBeInstanceOf(SileroVAD);
    });

    it('should compute frame counters correctly (ceil(300/32)=10, ceil(500/32)=16)', () => {
      // We verify this indirectly through the state machine behaviour.
      // With default options: frameDurationMs = (512/16000)*1000 = 32ms
      // minSpeechFrames = ceil(300/32) = ceil(9.375) = 10
      // silenceFrames = ceil(500/32) = ceil(15.625) = 16
      const vad = new SileroVAD();
      // Access private for verification — using type casting
      const internal = vad as unknown as {
        _minSpeechFrames: number;
        _silenceFrames: number;
        _frameDurationMs: number;
      };
      expect(internal._frameDurationMs).toBe(32);
      expect(internal._minSpeechFrames).toBe(10);
      expect(internal._silenceFrames).toBe(16);
    });
  });

  // =========================================================================
  // 2. init()
  // =========================================================================
  describe('init()', () => {
    it('should load model from cache when available (cache hit)', async () => {
      // Pre-populate the cache
      const cache = await globalThis.caches.open('guidekit-vad-v0.1.0-beta.3');
      await cache.put(
        'model.onnx',
        new Response(new ArrayBuffer(512)),
      );

      const vad = new SileroVAD();
      await vad.init();

      expect(vad.isReady).toBe(true);
      // fetch should NOT have been called because cache hit
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockSessionCreate).toHaveBeenCalledTimes(1);
    });

    it('should fetch model on cache miss and save to cache', async () => {
      const vad = new SileroVAD();
      await vad.init();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockSessionCreate).toHaveBeenCalledTimes(1);
      expect(vad.isReady).toBe(true);
    });

    it('should throw when fetch fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        arrayBuffer: vi.fn(),
      });

      const vad = new SileroVAD();
      await expect(vad.init()).rejects.toThrow('Failed to fetch model: 404 Not Found');
    });

    it('should create an ONNX InferenceSession with correct options', async () => {
      const vad = new SileroVAD();
      await vad.init();

      expect(mockSessionCreate).toHaveBeenCalledWith(expect.anything(), {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
    });

    it('should emit vad-ready event upon successful init', async () => {
      const vad = new SileroVAD();
      const readyCb = vi.fn();
      vad.onReady(readyCb);

      await vad.init();

      expect(readyCb).toHaveBeenCalledTimes(1);
      expect(readyCb).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'vad-ready', timestamp: expect.any(Number) }),
      );
    });

    it('should throw if called after destroy', async () => {
      const vad = await createReadyVAD();
      await vad.destroy();

      await expect(vad.init()).rejects.toThrow('Cannot init after destroy');
    });
  });

  // =========================================================================
  // 3. processFrame()
  // =========================================================================
  describe('processFrame()', () => {
    it('should throw if model not loaded', async () => {
      const vad = new SileroVAD();
      await expect(vad.processFrame(makeFrame())).rejects.toThrow(
        'Model not loaded. Call init() first.',
      );
    });

    it('should throw if frame length is not 512', async () => {
      const vad = await createReadyVAD();
      const badFrame = new Float32Array(256);
      await expect(vad.processFrame(badFrame)).rejects.toThrow(
        'Expected 512 samples, got 256',
      );
    });

    it('should pass correct tensor feeds (input, sr, state) to session.run', async () => {
      const vad = await createReadyVAD();
      const frame = makeFrame(0.5);
      await vad.processFrame(frame);

      expect(mockRun).toHaveBeenCalledTimes(1);
      const feeds = mockRun.mock.calls[0]![0] as Record<string, unknown>;
      expect(feeds).toHaveProperty('input');
      expect(feeds).toHaveProperty('sr');
      expect(feeds).toHaveProperty('state');
      // Should NOT have h0/c0 keys (that was the old Silero v4 format)
      expect(feeds).not.toHaveProperty('h0');
      expect(feeds).not.toHaveProperty('c0');
    });

    it('should return probability and update LSTM state', async () => {
      mockRun.mockResolvedValueOnce({
        output: { data: [0.85] },
        stateN: { data: new Float32Array(256).fill(0.1), dispose: mockDispose },
      });

      const vad = await createReadyVAD();
      const prob = await vad.processFrame(makeFrame());
      expect(prob).toBe(0.85);

      // Calling again should use the updated state (stateN from previous call)
      mockRun.mockResolvedValueOnce({
        output: { data: [0.9] },
        stateN: { data: new Float32Array(256).fill(0.2), dispose: mockDispose },
      });
      const prob2 = await vad.processFrame(makeFrame());
      expect(prob2).toBe(0.9);

      // The second call should have used the state returned from the first call
      const secondCallFeeds = mockRun.mock.calls[1]![0] as Record<string, { data: Float32Array }>;
      expect(secondCallFeeds.state!.data[0]).toBeCloseTo(0.1);
    });
  });

  // =========================================================================
  // 4. State machine
  // =========================================================================
  describe('State machine', () => {
    it('should NOT fire speech-start until minSpeechFrames consecutive above-threshold frames', async () => {
      const vad = await createReadyVAD();
      const speechStartCb = vi.fn();
      vad.onSpeechStart(speechStartCb);

      // Simulate calling _handleFrame with high-probability results for 9 frames
      // (just below minSpeechFrames=10). We need to bypass calibration.
      // Access internals to skip calibration.
      const internal = vad as unknown as {
        _isCalibrating: boolean;
        _isStarted: boolean;
        _handleFrame: (frame: Float32Array) => Promise<void>;
      };
      internal._isCalibrating = false;
      internal._isStarted = true;

      // Return high probability for each call
      for (let i = 0; i < 9; i++) {
        mockRun.mockResolvedValueOnce({
          output: { data: [0.8] },
          stateN: { data: new Float32Array(256).fill(0), dispose: mockDispose },
        });
      }

      for (let i = 0; i < 9; i++) {
        await internal._handleFrame(makeFrame());
      }

      expect(speechStartCb).not.toHaveBeenCalled();
    });

    it('should fire speech-start after minSpeechFrames consecutive above-threshold frames', async () => {
      const vad = await createReadyVAD();
      const speechStartCb = vi.fn();
      vad.onSpeechStart(speechStartCb);

      const internal = vad as unknown as {
        _isCalibrating: boolean;
        _isStarted: boolean;
        _handleFrame: (frame: Float32Array) => Promise<void>;
      };
      internal._isCalibrating = false;
      internal._isStarted = true;

      // Return high probability for 10 frames (= minSpeechFrames)
      for (let i = 0; i < 10; i++) {
        mockRun.mockResolvedValueOnce({
          output: { data: [0.8] },
          stateN: { data: new Float32Array(256).fill(0), dispose: mockDispose },
        });
      }

      for (let i = 0; i < 10; i++) {
        await internal._handleFrame(makeFrame());
      }

      expect(speechStartCb).toHaveBeenCalledTimes(1);
      expect(speechStartCb).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'speech-start',
          probability: 0.8,
        }),
      );
    });

    it('should NOT fire speech-end until silenceFrames consecutive below-threshold frames', async () => {
      const vad = await createReadyVAD();
      const speechEndCb = vi.fn();
      vad.onSpeechEnd(speechEndCb);

      const internal = vad as unknown as {
        _isCalibrating: boolean;
        _isStarted: boolean;
        _isSpeaking: boolean;
        _consecutiveSpeechFrames: number;
        _handleFrame: (frame: Float32Array) => Promise<void>;
      };
      internal._isCalibrating = false;
      internal._isStarted = true;
      internal._isSpeaking = true;
      internal._consecutiveSpeechFrames = 10;

      // Send 15 silence frames (1 less than silenceFrames=16)
      for (let i = 0; i < 15; i++) {
        mockRun.mockResolvedValueOnce({
          output: { data: [0.1] },
          stateN: { data: new Float32Array(256).fill(0), dispose: mockDispose },
        });
      }

      for (let i = 0; i < 15; i++) {
        await internal._handleFrame(makeFrame());
      }

      expect(speechEndCb).not.toHaveBeenCalled();
      expect(internal._isSpeaking).toBe(true);
    });

    it('should fire speech-end after silenceFrames consecutive below-threshold frames', async () => {
      const vad = await createReadyVAD();
      const speechEndCb = vi.fn();
      vad.onSpeechEnd(speechEndCb);

      const internal = vad as unknown as {
        _isCalibrating: boolean;
        _isStarted: boolean;
        _isSpeaking: boolean;
        _consecutiveSpeechFrames: number;
        _handleFrame: (frame: Float32Array) => Promise<void>;
      };
      internal._isCalibrating = false;
      internal._isStarted = true;
      internal._isSpeaking = true;
      internal._consecutiveSpeechFrames = 10;

      // Send 16 silence frames (= silenceFrames)
      for (let i = 0; i < 16; i++) {
        mockRun.mockResolvedValueOnce({
          output: { data: [0.1] },
          stateN: { data: new Float32Array(256).fill(0), dispose: mockDispose },
        });
      }

      for (let i = 0; i < 16; i++) {
        await internal._handleFrame(makeFrame());
      }

      expect(speechEndCb).toHaveBeenCalledTimes(1);
      expect(speechEndCb).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'speech-end',
          probability: 0.1,
        }),
      );
      expect(internal._isSpeaking).toBe(false);
    });

    it('should adjust threshold when noise calibration detects high ambient noise', async () => {
      const vad = await createReadyVAD();

      const internal = vad as unknown as {
        _isCalibrating: boolean;
        _isStarted: boolean;
        _calibrationSamples: number[];
        _calibrationFramesNeeded: number;
        _calibratedThreshold: number;
        _threshold: number;
        _finishCalibration: () => void;
      };
      internal._isCalibrating = true;
      internal._isStarted = true;
      internal._calibrationFramesNeeded = 15;

      // Simulate high noise floor: avg = 0.45, so 0.45 + 0.15 = 0.60 > threshold 0.5
      internal._calibrationSamples = Array(15).fill(0.45);
      internal._finishCalibration();

      // Threshold should be nudged up: avgNoise + 0.15 = 0.60
      expect(internal._calibratedThreshold).toBeCloseTo(0.60);
      expect(internal._isCalibrating).toBe(false);
    });

    it('should keep original threshold when noise floor is low', async () => {
      const vad = await createReadyVAD();

      const internal = vad as unknown as {
        _isCalibrating: boolean;
        _isStarted: boolean;
        _calibrationSamples: number[];
        _calibrationFramesNeeded: number;
        _calibratedThreshold: number;
        _threshold: number;
        _finishCalibration: () => void;
      };
      internal._isCalibrating = true;
      internal._isStarted = true;
      internal._calibrationFramesNeeded = 15;

      // Low noise: avg = 0.1, so 0.1 + 0.15 = 0.25 < threshold 0.5
      internal._calibrationSamples = Array(15).fill(0.1);
      internal._finishCalibration();

      expect(internal._calibratedThreshold).toBe(0.5);
      expect(internal._isCalibrating).toBe(false);
    });
  });

  // =========================================================================
  // 5. start() / stop()
  // =========================================================================
  describe('start() / stop()', () => {
    it('should set up audio pipeline with AudioContext and ScriptProcessorNode', async () => {
      const vad = await createReadyVAD();
      const stream = createMockMediaStream();

      vad.start(stream);

      expect(AudioContextSpy).toHaveBeenCalledTimes(1);
      expect(vad.stream).toBe(stream);

      // The AudioContext should have been asked to create a script processor
      const ctxInstance = AudioContextSpy.mock.results[0]!.value;
      expect(ctxInstance.createMediaStreamSource).toHaveBeenCalledWith(stream);
      expect(ctxInstance.createScriptProcessor).toHaveBeenCalledWith(4096, 1, 1);

      vad.stop();
    });

    it('should throw if model is not ready', () => {
      const vad = new SileroVAD();
      const stream = createMockMediaStream();

      expect(() => vad.start(stream)).toThrow('Model not loaded. Call init() first.');
    });

    it('should throw if instance is destroyed', async () => {
      const vad = await createReadyVAD();
      await vad.destroy();
      const stream = createMockMediaStream();

      expect(() => vad.start(stream)).toThrow('Cannot start after destroy');
    });

    it('should emit speech-end when stop() is called while speaking', async () => {
      const vad = await createReadyVAD();
      const speechEndCb = vi.fn();
      vad.onSpeechEnd(speechEndCb);

      const stream = createMockMediaStream();
      vad.start(stream);

      // Manually set speaking state
      const internal = vad as unknown as { _isSpeaking: boolean };
      internal._isSpeaking = true;

      vad.stop();

      expect(speechEndCb).toHaveBeenCalledTimes(1);
      expect(speechEndCb).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'speech-end',
          probability: 0,
        }),
      );
    });
  });

  // =========================================================================
  // 6. destroy()
  // =========================================================================
  describe('destroy()', () => {
    it('should release the ONNX session', async () => {
      const vad = await createReadyVAD();
      await vad.destroy();

      expect(mockRelease).toHaveBeenCalledTimes(1);
      expect(vad.isReady).toBe(false);
    });

    it('should dispose LSTM state tensors', async () => {
      const vad = await createReadyVAD();
      // The _state tensor has a dispose mock
      const internal = vad as unknown as { _state: { dispose: () => void } | null };
      const stateTensor = internal._state;
      expect(stateTensor).not.toBeNull();

      await vad.destroy();

      expect(mockDispose).toHaveBeenCalled();
      expect(internal._state).toBeNull();
    });

    it('should clear all event listeners', async () => {
      const vad = await createReadyVAD();
      const cb = vi.fn();
      vad.onSpeechStart(cb);
      vad.onSpeechEnd(cb);
      vad.onReady(cb);

      await vad.destroy();

      const internal = vad as unknown as { _listeners: Map<string, Set<unknown>> };
      expect(internal._listeners.size).toBe(0);
    });
  });

  // =========================================================================
  // 7. Events
  // =========================================================================
  describe('Events', () => {
    it('should support unsubscription via returned function', async () => {
      const vad = await createReadyVAD();
      const cb = vi.fn();
      const unsub = vad.onSpeechStart(cb);

      const internal = vad as unknown as {
        _emit: (event: { type: string; timestamp: number; probability?: number }) => void;
      };

      internal._emit({ type: 'speech-start', timestamp: Date.now(), probability: 0.8 });
      expect(cb).toHaveBeenCalledTimes(1);

      unsub();

      internal._emit({ type: 'speech-start', timestamp: Date.now(), probability: 0.9 });
      expect(cb).toHaveBeenCalledTimes(1); // Still 1 — not called again
    });

    it('should catch callback errors without crashing', async () => {
      const vad = await createReadyVAD();
      const errorCb = vi.fn(() => {
        throw new Error('callback explosion');
      });
      const safeCb = vi.fn();

      vad.onSpeechStart(errorCb);
      vad.onSpeechStart(safeCb);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const internal = vad as unknown as {
        _emit: (event: { type: string; timestamp: number; probability?: number }) => void;
      };
      internal._emit({ type: 'speech-start', timestamp: Date.now(), probability: 0.8 });

      // The throwing callback should not prevent the safe callback from firing
      expect(errorCb).toHaveBeenCalledTimes(1);
      expect(safeCb).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should fire all three event types (vad-ready, speech-start, speech-end)', async () => {
      const readyCb = vi.fn();
      const startCb = vi.fn();
      const endCb = vi.fn();

      const vad = new SileroVAD();
      vad.onReady(readyCb);
      vad.onSpeechStart(startCb);
      vad.onSpeechEnd(endCb);

      // 1) vad-ready fires on init
      await vad.init();
      expect(readyCb).toHaveBeenCalledTimes(1);
      expect(readyCb).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'vad-ready' }),
      );

      // 2) speech-start via internal emit
      const internal = vad as unknown as {
        _emit: (event: { type: string; timestamp: number; probability?: number }) => void;
      };
      internal._emit({ type: 'speech-start', timestamp: Date.now(), probability: 0.75 });
      expect(startCb).toHaveBeenCalledTimes(1);
      expect(startCb).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'speech-start', probability: 0.75 }),
      );

      // 3) speech-end via internal emit
      internal._emit({ type: 'speech-end', timestamp: Date.now(), probability: 0.05 });
      expect(endCb).toHaveBeenCalledTimes(1);
      expect(endCb).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'speech-end', probability: 0.05 }),
      );
    });
  });

  // =========================================================================
  // Bonus: createVAD factory
  // =========================================================================
  describe('createVAD()', () => {
    it('should return an initialised SileroVAD instance', async () => {
      const vad = await createVAD();
      expect(vad).toBeInstanceOf(SileroVAD);
      expect(vad.isReady).toBe(true);
    });
  });

  // =========================================================================
  // Bonus: Exported constants
  // =========================================================================
  describe('Exported constants', () => {
    it('should export FRAME_SIZE = 512', () => {
      expect(FRAME_SIZE).toBe(512);
    });

    it('should export TARGET_SAMPLE_RATE = 16000', () => {
      expect(TARGET_SAMPLE_RATE).toBe(16000);
    });
  });
});
