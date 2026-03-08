// ---------------------------------------------------------------------------
// WebSpeechTTS – Unit Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSpeechTTS } from './web-speech-tts.js';

// ---------------------------------------------------------------------------
// Mock SpeechSynthesis + SpeechSynthesisUtterance
// ---------------------------------------------------------------------------

class MockSpeechSynthesisUtterance {
  text: string;
  lang = '';
  rate = 1;
  pitch = 1;
  voice: any = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: any) => void) | null = null;

  static instances: MockSpeechSynthesisUtterance[] = [];

  constructor(text: string) {
    this.text = text;
    MockSpeechSynthesisUtterance.instances.push(this);
  }
}

const mockVoices = [
  { name: 'Google US English', lang: 'en-US', default: true, localService: true, voiceURI: '' },
  { name: 'Google UK English Female', lang: 'en-GB', default: false, localService: true, voiceURI: '' },
];

function createMockSpeechSynthesis() {
  return {
    speak: vi.fn((utterance: MockSpeechSynthesisUtterance) => {
      // Simulate start and end
      queueMicrotask(() => utterance.onstart?.());
      queueMicrotask(() => utterance.onend?.());
    }),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: vi.fn(() => mockVoices),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

function installMock() {
  MockSpeechSynthesisUtterance.instances = [];
  const synth = createMockSpeechSynthesis();
  Object.defineProperty(window, 'speechSynthesis', {
    value: synth,
    writable: true,
    configurable: true,
  });
  (globalThis as any).SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;
  return synth;
}

function removeMock() {
  delete (window as any).speechSynthesis;
  delete (globalThis as any).SpeechSynthesisUtterance;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebSpeechTTS', () => {
  let synth: ReturnType<typeof createMockSpeechSynthesis>;

  beforeEach(() => {
    synth = installMock();
  });

  afterEach(() => {
    removeMock();
    MockSpeechSynthesisUtterance.instances = [];
  });

  // ── isSupported() ───────────────────────────────────────────────────

  it('isSupported returns true when speechSynthesis is available', () => {
    expect(WebSpeechTTS.isSupported()).toBe(true);
  });

  it('isSupported returns false when speechSynthesis is unavailable', () => {
    removeMock();
    expect(WebSpeechTTS.isSupported()).toBe(false);
  });

  // ── connect() ───────────────────────────────────────────────────────

  it('connect() sets isConnected to true', async () => {
    const tts = new WebSpeechTTS();
    await tts.connect();
    expect(tts.isConnected).toBe(true);
  });

  it('connect() is idempotent', async () => {
    const tts = new WebSpeechTTS();
    await tts.connect();
    await tts.connect(); // should not throw
    expect(tts.isConnected).toBe(true);
  });

  it('connect() resolves requested voice by name', async () => {
    const tts = new WebSpeechTTS({ voice: 'Google UK' });
    await tts.connect();
    expect(tts.isConnected).toBe(true);
  });

  // ── speak() ─────────────────────────────────────────────────────────

  it('speak() calls speechSynthesis.speak', async () => {
    const tts = new WebSpeechTTS();
    await tts.connect();
    tts.speak('Hello world');
    expect(synth.speak).toHaveBeenCalled();
  });

  it('speak() does nothing when not connected', () => {
    const tts = new WebSpeechTTS();
    tts.speak('Hello'); // should not throw
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('speak() does nothing with empty text', async () => {
    const tts = new WebSpeechTTS();
    await tts.connect();
    tts.speak('');
    tts.speak('   ');
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('speak() emits audio events', async () => {
    const tts = new WebSpeechTTS();
    const cb = vi.fn();
    tts.onAudio(cb);
    await tts.connect();
    tts.speak('Hello');

    // Wait for microtask callbacks
    await new Promise((r) => queueMicrotask(r));
    await new Promise((r) => queueMicrotask(r));

    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ isFinal: false }),
    );
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ isFinal: true }),
    );
  });

  it('speak() sets utterance properties', async () => {
    const tts = new WebSpeechTTS({ rate: 1.5, pitch: 0.8, language: 'fr-FR' });
    await tts.connect();
    tts.speak('Bonjour');

    const utt = MockSpeechSynthesisUtterance.instances[0]!;
    expect(utt.rate).toBe(1.5);
    expect(utt.pitch).toBe(0.8);
    expect(utt.lang).toBe('fr-FR');
  });

  // ── flush() ─────────────────────────────────────────────────────────

  it('flush() is a no-op', async () => {
    const tts = new WebSpeechTTS();
    await tts.connect();
    expect(() => tts.flush()).not.toThrow();
  });

  // ── onAudio() ───────────────────────────────────────────────────────

  it('unsubscribe from onAudio works', async () => {
    const tts = new WebSpeechTTS();
    const cb = vi.fn();
    const unsub = tts.onAudio(cb);
    unsub();
    await tts.connect();
    tts.speak('test');
    await new Promise((r) => queueMicrotask(r));
    expect(cb).not.toHaveBeenCalled();
  });

  it('unsubscribe is idempotent', () => {
    const tts = new WebSpeechTTS();
    const unsub = tts.onAudio(vi.fn());
    unsub();
    unsub(); // should not throw
  });

  // ── stop() ──────────────────────────────────────────────────────────

  it('stop() cancels speech synthesis', async () => {
    const tts = new WebSpeechTTS();
    await tts.connect();
    tts.stop();
    expect(synth.cancel).toHaveBeenCalled();
  });

  // ── close() ─────────────────────────────────────────────────────────

  it('close() stops and resets state', async () => {
    const tts = new WebSpeechTTS();
    await tts.connect();
    tts.close();
    expect(tts.isConnected).toBe(false);
  });

  // ── destroy() ───────────────────────────────────────────────────────

  it('destroy() cleans up and clears callbacks', async () => {
    const tts = new WebSpeechTTS();
    const cb = vi.fn();
    tts.onAudio(cb);
    await tts.connect();
    tts.destroy();
    expect(tts.isConnected).toBe(false);
  });

  // ── suspend() / resume() ────────────────────────────────────────────

  it('suspend() pauses synthesis and prevents speaking', async () => {
    const tts = new WebSpeechTTS();
    await tts.connect();
    tts.suspend();
    expect(synth.pause).toHaveBeenCalled();

    // speak() should be a no-op while suspended
    synth.speak.mockClear();
    tts.speak('test');
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('suspend() is idempotent', async () => {
    const tts = new WebSpeechTTS();
    await tts.connect();
    tts.suspend();
    tts.suspend(); // should not throw
  });

  it('resume() resumes synthesis', async () => {
    const tts = new WebSpeechTTS();
    await tts.connect();
    tts.suspend();
    tts.resume();
    expect(synth.resume).toHaveBeenCalled();
  });

  it('resume() is a no-op when not suspended', async () => {
    const tts = new WebSpeechTTS();
    await tts.connect();
    tts.resume(); // should not throw
    expect(synth.resume).not.toHaveBeenCalled();
  });
});
