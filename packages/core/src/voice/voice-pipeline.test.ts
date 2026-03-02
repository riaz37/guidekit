// ---------------------------------------------------------------------------
// VoicePipeline – Unit Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VoiceState } from './index.js';

// ---------------------------------------------------------------------------
// Shared mock state — vi.hoisted ensures this is available to vi.mock factories
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => {
  // --- Mock VAD instance creator ---
  function createMockVAD() {
    const speechStartCallbacks: Function[] = [];
    const speechEndCallbacks: Function[] = [];

    return {
      init: vi.fn(() => Promise.resolve()),
      start: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn(() => Promise.resolve()),
      onSpeechStart: vi.fn((cb: Function) => {
        speechStartCallbacks.push(cb);
        return () => {
          const idx = speechStartCallbacks.indexOf(cb);
          if (idx !== -1) speechStartCallbacks.splice(idx, 1);
        };
      }),
      onSpeechEnd: vi.fn((cb: Function) => {
        speechEndCallbacks.push(cb);
        return () => {
          const idx = speechEndCallbacks.indexOf(cb);
          if (idx !== -1) speechEndCallbacks.splice(idx, 1);
        };
      }),
      isSpeaking: false,
      isReady: true,
      _fireSpeechStart() {
        for (const cb of speechStartCallbacks) cb({ type: 'speech-start', timestamp: Date.now() });
      },
      _fireSpeechEnd() {
        for (const cb of speechEndCallbacks) cb({ type: 'speech-end', timestamp: Date.now() });
      },
    };
  }

  // --- Mock STT creator ---
  function createMockSTT() {
    const transcriptCallbacks: Function[] = [];

    return {
      connect: vi.fn(() => Promise.resolve()),
      close: vi.fn(),
      destroy: vi.fn(),
      sendAudio: vi.fn(),
      isConnected: true,
      onTranscript: vi.fn((cb: Function) => {
        transcriptCallbacks.push(cb);
        return () => {
          const idx = transcriptCallbacks.indexOf(cb);
          if (idx !== -1) transcriptCallbacks.splice(idx, 1);
        };
      }),
      _fireTranscript(text: string, isFinal: boolean, confidence = 0.95) {
        for (const cb of transcriptCallbacks) {
          cb({ text, isFinal, confidence, timestamp: Date.now() });
        }
      },
    };
  }

  // --- Mock TTS creator ---
  function createMockTTS() {
    const audioCallbacks: Function[] = [];

    return {
      connect: vi.fn(() => Promise.resolve()),
      close: vi.fn(),
      destroy: vi.fn(),
      speak: vi.fn(),
      flush: vi.fn(),
      isConnected: true,
      onAudio: vi.fn((cb: Function) => {
        audioCallbacks.push(cb);
        return () => {
          const idx = audioCallbacks.indexOf(cb);
          if (idx !== -1) audioCallbacks.splice(idx, 1);
        };
      }),
      _fireAudio(audioBuffer: ArrayBuffer, isFinal: boolean) {
        for (const cb of audioCallbacks) {
          cb({ audio: audioBuffer, isFinal, timestamp: Date.now() });
        }
      },
    };
  }

  return {
    createMockVAD,
    createMockSTT,
    createMockTTS,
    vad: null as ReturnType<typeof createMockVAD> | null,
    stt: null as ReturnType<typeof createMockSTT> | null,
    tts: null as ReturnType<typeof createMockTTS> | null,
    vadImportShouldFail: false,
  };
});

// ---------------------------------------------------------------------------
// vi.mock declarations — these are hoisted, but reference mockState which
// is also hoisted via vi.hoisted
// ---------------------------------------------------------------------------

vi.mock('@guidekit/vad', () => ({
  SileroVAD: vi.fn().mockImplementation(() => {
    if (mockState.vadImportShouldFail) {
      throw new Error('VAD package not available');
    }
    return mockState.vad;
  }),
}));

vi.mock('./deepgram-stt.js', () => ({
  DeepgramSTT: vi.fn().mockImplementation(() => mockState.stt),
}));

vi.mock('./elevenlabs-tts.js', () => ({
  ElevenLabsTTS: vi.fn().mockImplementation(() => mockState.tts),
}));

// ---------------------------------------------------------------------------
// Mock browser APIs
// ---------------------------------------------------------------------------

class MockMediaStreamTrack {
  kind = 'audio';
  enabled = true;
  readyState = 'live';
  stop() {
    this.readyState = 'ended';
  }
}

class MockMediaStream {
  private _tracks: MockMediaStreamTrack[];

  constructor() {
    this._tracks = [new MockMediaStreamTrack()];
  }

  getTracks() {
    return this._tracks;
  }

  getAudioTracks() {
    return this._tracks;
  }
}

class MockAudioBufferSourceNode {
  buffer: any = null;
  onended: (() => void) | null = null;
  connect() { return this; }
  disconnect() {}
  start() {}
  stop() {}
}

class MockScriptProcessorNode {
  onaudioprocess: ((event: any) => void) | null = null;
  connect() { return this; }
  disconnect() {}
}

class MockMediaStreamAudioSourceNode {
  connect() { return new MockScriptProcessorNode(); }
  disconnect() {}
}

class MockAudioBuffer {
  duration = 0.5;
  sampleRate = 44100;
  length = 22050;
  numberOfChannels = 1;
  getChannelData() {
    return new Float32Array(this.length);
  }
}

class MockAudioContext {
  state = 'running';
  sampleRate = 44100;
  currentTime = 0;
  destination = {};

  createMediaStreamSource() { return new MockMediaStreamAudioSourceNode(); }
  createScriptProcessor() { return new MockScriptProcessorNode(); }
  createBufferSource() { return new MockAudioBufferSourceNode(); }
  createBuffer() { return new MockAudioBuffer(); }
  decodeAudioData(
    data: ArrayBuffer,
    success: (buffer: any) => void,
    _error?: (err: any) => void,
  ) {
    success(new MockAudioBuffer());
  }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

// ---------------------------------------------------------------------------
// Import the module under test — vi.mock calls above are hoisted so this
// import will receive the mocked dependencies.
// ---------------------------------------------------------------------------

import { VoicePipeline } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createPipeline() {
  return new VoicePipeline({
    sttConfig: { provider: 'deepgram', apiKey: 'test-key' },
    ttsConfig: { provider: 'elevenlabs', apiKey: 'test-key' },
    debug: false,
  });
}

async function createInitializedPipeline() {
  const pipeline = createPipeline();
  await pipeline.init();
  return pipeline;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VoicePipeline', () => {
  let getUserMediaMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockState.vadImportShouldFail = false;

    // Create fresh mocks for subsystems
    mockState.vad = mockState.createMockVAD();
    mockState.stt = mockState.createMockSTT();
    mockState.tts = mockState.createMockTTS();

    // Set up global browser APIs
    // jsdom provides `window` and `navigator` but not `AudioContext` or
    // `navigator.mediaDevices.getUserMedia`. We install our mocks on the
    // existing global objects where possible.
    (globalThis as any).AudioContext = MockAudioContext;

    // Mock getUserMedia — jsdom has navigator but no mediaDevices
    getUserMediaMock = vi.fn(() => Promise.resolve(new MockMediaStream()));
    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: getUserMediaMock },
        writable: true,
        configurable: true,
      });
    } else {
      navigator.mediaDevices.getUserMedia = getUserMediaMock as any;
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    // Use clearAllMocks instead of restoreAllMocks to preserve mockImplementation
    // set by vi.mock factories above. restoreAllMocks would undo them.
    vi.clearAllMocks();
    delete (globalThis as any).AudioContext;
    delete (globalThis as any).webkitAudioContext;
  });

  // ── Initial state is 'idle' ───────────────────────────────────────

  it('initial state is "idle"', () => {
    const pipeline = createPipeline();
    expect(pipeline.state).toBe('idle');
  });

  // ── State transitions follow the spec ──────────────────────────────

  it('transitions idle -> listening on startListening()', async () => {
    const pipeline = await createInitializedPipeline();
    const states: VoiceState[] = [];
    pipeline.onStateChange((s) => states.push(s));

    await pipeline.startListening();

    expect(pipeline.state).toBe('listening');
    expect(states).toContain('listening');
  });

  it('transitions listening -> processing via processTranscript()', async () => {
    const pipeline = await createInitializedPipeline();
    await pipeline.startListening();

    const states: VoiceState[] = [];
    pipeline.onStateChange((s) => states.push(s));

    // Mock TTS to emit final audio immediately so speak() resolves
    mockState.tts!.flush.mockImplementation(() => {
      setTimeout(() => {
        mockState.tts!._fireAudio(new ArrayBuffer(0), true);
      }, 10);
    });

    const processPromise = pipeline.processTranscript('hello', async () => 'Hi there!');

    await vi.advanceTimersByTimeAsync(200);
    await processPromise;

    expect(states).toContain('processing');
  });

  it('transitions processing -> speaking -> idle through full flow', async () => {
    const pipeline = await createInitializedPipeline();
    await pipeline.startListening();

    const states: VoiceState[] = [];
    pipeline.onStateChange((s) => states.push(s));

    // Mock TTS to emit final audio immediately on flush
    mockState.tts!.flush.mockImplementation(() => {
      setTimeout(() => {
        mockState.tts!._fireAudio(new ArrayBuffer(0), true);
      }, 10);
    });

    const processPromise = pipeline.processTranscript('hello', async () => 'Hi there!');

    await vi.advanceTimersByTimeAsync(200);
    await processPromise;

    expect(states).toContain('processing');
    expect(states).toContain('speaking');
    expect(states).toContain('idle');
  });

  // ── onStateChange fires on transitions ─────────────────────────────

  it('onStateChange fires on transitions', async () => {
    const pipeline = await createInitializedPipeline();
    const changes: Array<{ state: VoiceState; prev: VoiceState }> = [];
    pipeline.onStateChange((state, prev) => {
      changes.push({ state, prev });
    });

    await pipeline.startListening();

    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0]).toEqual({ state: 'listening', prev: 'idle' });
  });

  // ── onTranscript fires when transcript received ────────────────────

  it('onTranscript fires when transcript received', async () => {
    const pipeline = await createInitializedPipeline();
    const transcripts: Array<{ text: string; isFinal: boolean }> = [];
    pipeline.onTranscript((text, isFinal) => {
      transcripts.push({ text, isFinal });
    });

    await pipeline.startListening();

    // Simulate STT emitting a transcript
    mockState.stt!._fireTranscript('hello world', false);

    expect(transcripts).toHaveLength(1);
    expect(transcripts[0]).toEqual({ text: 'hello world', isFinal: false });

    // Simulate a final transcript
    mockState.stt!._fireTranscript('hello world', true);

    expect(transcripts).toHaveLength(2);
    expect(transcripts[1]).toEqual({ text: 'hello world', isFinal: true });
  });

  // ── stopSpeaking() triggers barge-in ───────────────────────────────

  it('stopSpeaking() stops active playback and clears TTS', async () => {
    const pipeline = await createInitializedPipeline();
    await pipeline.startListening();

    // Put pipeline into processing state
    let llmResolve!: (value: string) => void;
    const llmPromise = new Promise<string>((resolve) => {
      llmResolve = resolve;
    });

    const _processPromise = pipeline.processTranscript('hello', () => llmPromise);
    await vi.advanceTimersByTimeAsync(0);

    expect(pipeline.state).toBe('processing');

    // Resolve the LLM
    llmResolve('Hi there!');
    await vi.advanceTimersByTimeAsync(0);

    // Call stopSpeaking
    pipeline.stopSpeaking();

    // TTS close should have been called
    expect(mockState.tts!.close).toHaveBeenCalled();
  });

  // ── Echo detection: discards transcript matching recent TTS text ───

  it('echo detection discards transcript matching recent TTS text', async () => {
    const pipeline = await createInitializedPipeline();
    const transcripts: Array<{ text: string; isFinal: boolean }> = [];
    pipeline.onTranscript((text, isFinal) => {
      transcripts.push({ text, isFinal });
    });

    await pipeline.startListening();

    // Trigger speak() to record echo info
    mockState.tts!.flush.mockImplementation(() => {
      setTimeout(() => {
        mockState.tts!._fireAudio(new ArrayBuffer(0), true);
      }, 10);
    });

    const speakPromise = pipeline.speak('hello world good morning today');
    await vi.advanceTimersByTimeAsync(200);
    await speakPromise;

    // Pipeline should be back to idle. Start listening again.
    await pipeline.startListening();

    // Simulate a transcript that matches the TTS text (echo)
    mockState.stt!._fireTranscript('hello world good morning today', true);

    // The echoed final transcript should be discarded
    const finalTranscripts = transcripts.filter((t) => t.isFinal);
    expect(finalTranscripts).toHaveLength(0);
  });

  // ── Echo detection: passes transcript that doesn't match ───────────

  it('echo detection passes transcript that does not match', async () => {
    const pipeline = await createInitializedPipeline();
    const transcripts: Array<{ text: string; isFinal: boolean }> = [];
    pipeline.onTranscript((text, isFinal) => {
      transcripts.push({ text, isFinal });
    });

    await pipeline.startListening();

    // Trigger speak to record echo info
    mockState.tts!.flush.mockImplementation(() => {
      setTimeout(() => {
        mockState.tts!._fireAudio(new ArrayBuffer(0), true);
      }, 10);
    });
    const speakPromise = pipeline.speak('hello world good morning today');
    await vi.advanceTimersByTimeAsync(200);
    await speakPromise;

    await pipeline.startListening();

    // Send a transcript that does NOT match the TTS text
    mockState.stt!._fireTranscript('something completely different', true);

    const finalTranscripts = transcripts.filter((t) => t.isFinal);
    expect(finalTranscripts).toHaveLength(1);
    expect(finalTranscripts[0]!.text).toBe('something completely different');
  });

  // ── destroy() cleans up all resources ──────────────────────────────

  it('destroy() cleans up all resources', async () => {
    const pipeline = await createInitializedPipeline();
    await pipeline.startListening();

    const stateChangeCb = vi.fn();
    const transcriptCb = vi.fn();
    pipeline.onStateChange(stateChangeCb);
    pipeline.onTranscript(transcriptCb);

    await pipeline.destroy();

    // Subsystem destroy methods should have been called
    expect(mockState.vad!.destroy).toHaveBeenCalled();
    expect(mockState.stt!.destroy).toHaveBeenCalled();
    expect(mockState.tts!.destroy).toHaveBeenCalled();

    // After destroy, attempting further operations should be no-ops.
    // startListening() should do nothing (returns immediately).
    const cbAfterDestroy = vi.fn();
    pipeline.onStateChange(cbAfterDestroy);
    await pipeline.startListening();
    // Callback was added after destroy cleared the set, but startListening
    // exits early due to _destroyed flag, so no state changes occur.
    expect(cbAfterDestroy).not.toHaveBeenCalled();
  });

  // ── Handles missing @guidekit/vad gracefully ──────────────────────

  it('handles missing @guidekit/vad gracefully (emits BrowserSupportError)', async () => {
    mockState.vadImportShouldFail = true;

    const pipeline = createPipeline();

    await expect(pipeline.init()).rejects.toThrow(/Failed to load @guidekit\/vad/);
  });

  // ── onStateChange unsubscribe works ────────────────────────────────

  it('onStateChange unsubscribe stops receiving events', async () => {
    const pipeline = await createInitializedPipeline();
    const cb = vi.fn();
    const unsub = pipeline.onStateChange(cb);

    unsub();

    await pipeline.startListening();
    expect(cb).not.toHaveBeenCalled();
  });

  // ── onTranscript unsubscribe works ─────────────────────────────────

  it('onTranscript unsubscribe stops receiving events', async () => {
    const pipeline = await createInitializedPipeline();
    const cb = vi.fn();
    const unsub = pipeline.onTranscript(cb);

    unsub();

    await pipeline.startListening();
    mockState.stt!._fireTranscript('hello', false);

    expect(cb).not.toHaveBeenCalled();
  });

  // ── Double unsubscribe is safe ─────────────────────────────────────

  it('double unsubscribe is safe', async () => {
    const pipeline = await createInitializedPipeline();
    const cb = vi.fn();
    const unsub = pipeline.onStateChange(cb);

    unsub();
    unsub(); // second call should not throw

    await pipeline.startListening();
    expect(cb).not.toHaveBeenCalled();
  });

  // ── init() is idempotent ───────────────────────────────────────────

  it('init() is idempotent', async () => {
    const pipeline = createPipeline();
    await pipeline.init();

    // Second call should be a no-op (no error)
    await pipeline.init();

    // VAD init should have been called only once
    expect(mockState.vad!.init).toHaveBeenCalledOnce();
  });

  // ── stopListening transitions listening -> idle ────────────────────

  it('stopListening() transitions from listening to idle', async () => {
    const pipeline = await createInitializedPipeline();
    await pipeline.startListening();
    expect(pipeline.state).toBe('listening');

    pipeline.stopListening();
    expect(pipeline.state).toBe('idle');
  });

  // ── destroy() is idempotent ────────────────────────────────────────

  it('destroy() is idempotent', async () => {
    const pipeline = await createInitializedPipeline();

    await pipeline.destroy();
    // Second call should not throw
    await pipeline.destroy();
  });

  // ── processTranscript handles empty LLM response ───────────────────

  it('processTranscript transitions to idle on empty LLM response', async () => {
    const pipeline = await createInitializedPipeline();
    await pipeline.startListening();

    const states: VoiceState[] = [];
    pipeline.onStateChange((s) => states.push(s));

    await pipeline.processTranscript('hello', async () => '');
    await vi.advanceTimersByTimeAsync(0);

    // Should go processing -> idle (no speaking since response is empty)
    expect(states).toContain('processing');
    expect(states).toContain('idle');
    expect(states).not.toContain('speaking');
  });
});
