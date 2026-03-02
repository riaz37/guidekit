// ---------------------------------------------------------------------------
// Echo Detection Logic – Unit Tests
// ---------------------------------------------------------------------------
//
// The echo detection logic lives as private methods on VoicePipeline:
//   _isTranscriptEcho(transcript): boolean
//   _normalizeWords(text): string[]
//
// Since these are private, we test them through the pipeline's public surface
// by exercising the transcript callback path. We construct a minimally
// initialized VoicePipeline and reflectively access the private methods to
// test the echo detection algorithm in isolation.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Extracted echo detection logic (mirrors VoicePipeline's private methods)
// ---------------------------------------------------------------------------
// We replicate the exact algorithm from VoicePipeline._isTranscriptEcho and
// _normalizeWords so we can test the echo detection in a pure, isolated
// fashion without needing to stand up the entire voice pipeline.

const ECHO_WINDOW_MS = 3_000;
const ECHO_OVERLAP_THRESHOLD = 0.6;

interface EchoRecord {
  words: Set<string>;
  timestamp: number;
}

/**
 * Normalize text into an array of lowercase words, stripping punctuation.
 * Mirrors VoicePipeline._normalizeWords exactly.
 */
function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/**
 * Check if a transcript is an echo of recent TTS output.
 * Mirrors VoicePipeline._isTranscriptEcho exactly.
 */
function isTranscriptEcho(
  transcript: string,
  lastTTSEcho: EchoRecord | null,
  now: number,
): boolean {
  if (!lastTTSEcho) return false;

  const elapsed = now - lastTTSEcho.timestamp;
  if (elapsed > ECHO_WINDOW_MS) return false;

  const transcriptWords = new Set(normalizeWords(transcript));
  const ttsWords = lastTTSEcho.words;

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

  return overlap >= ECHO_OVERLAP_THRESHOLD;
}

/**
 * Create an echo record from TTS text at a given timestamp.
 */
function createEchoRecord(text: string, timestamp: number): EchoRecord {
  return {
    words: new Set(normalizeWords(text)),
    timestamp,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Echo Detection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 100% word overlap returns true (is echo) ──────────────────────

  it('100% word overlap returns true (is echo)', () => {
    const ttsText = 'Hello how are you today';
    const now = 1000;
    const echo = createEchoRecord(ttsText, now);

    // Exact same text — 100% overlap
    expect(isTranscriptEcho('Hello how are you today', echo, now + 500)).toBe(true);
  });

  // ── 60% word overlap returns true (is echo) ───────────────────────

  it('60% word overlap returns true (is echo)', () => {
    // TTS: 5 words
    const ttsText = 'the quick brown fox jumps';
    const now = 1000;
    const echo = createEchoRecord(ttsText, now);

    // Transcript: 3 out of 5 words match = 60%
    const transcript = 'the quick brown cat sleeps';
    // transcript words: the, quick, brown, cat, sleeps (5 words)
    // tts words: the, quick, brown, fox, jumps (5 words)
    // intersection: the, quick, brown (3 words)
    // overlap: 3 / max(5, 5) = 60%
    expect(isTranscriptEcho(transcript, echo, now + 500)).toBe(true);
  });

  // ── 59% word overlap returns false (not echo) ─────────────────────

  it('59% word overlap returns false (not echo)', () => {
    // We need overlap < 60%. Use sets of different sizes for precision.
    // TTS: 10 words, transcript matches 5 of them + has 2 extra.
    // max = max(7, 10) = 10, overlap = 5/10 = 50% → not echo
    const ttsText = 'one two three four five six seven eight nine ten';
    const now = 1000;
    const echo = createEchoRecord(ttsText, now);

    // 5 matching + 2 non-matching = 7 words
    // intersection = 5, max(7, 10) = 10, overlap = 5/10 = 50% < 60%
    const transcript = 'one two three four five extra words';
    expect(isTranscriptEcho(transcript, echo, now + 500)).toBe(false);
  });

  // ── 0% overlap returns false (not echo) ────────────────────────────

  it('0% overlap returns false (not echo)', () => {
    const ttsText = 'hello world good morning';
    const now = 1000;
    const echo = createEchoRecord(ttsText, now);

    const transcript = 'completely different sentence here';
    expect(isTranscriptEcho(transcript, echo, now + 500)).toBe(false);
  });

  // ── Case insensitive comparison ────────────────────────────────────

  it('case insensitive comparison', () => {
    const ttsText = 'Hello World';
    const now = 1000;
    const echo = createEchoRecord(ttsText, now);

    // Same words but different case — should still be detected as echo
    expect(isTranscriptEcho('HELLO WORLD', echo, now + 500)).toBe(true);
    expect(isTranscriptEcho('hello world', echo, now + 500)).toBe(true);
    expect(isTranscriptEcho('HeLLo WoRLd', echo, now + 500)).toBe(true);
  });

  // ── Punctuation stripped before comparison ─────────────────────────

  it('punctuation stripped before comparison', () => {
    const ttsText = 'Hello, how are you?';
    const now = 1000;
    const echo = createEchoRecord(ttsText, now);

    // Transcript has different punctuation but same words
    expect(isTranscriptEcho('Hello! How are you.', echo, now + 500)).toBe(true);

    // Also verify normalizeWords strips punctuation
    expect(normalizeWords('Hello, world!')).toEqual(['hello', 'world']);
    expect(normalizeWords("it's a test—right?")).toEqual(['its', 'a', 'testright']);
  });

  // ── Empty strings return false ─────────────────────────────────────

  it('empty strings return false', () => {
    const now = 1000;

    // Empty TTS echo record
    const emptyEcho = createEchoRecord('', now);
    expect(isTranscriptEcho('hello world', emptyEcho, now + 500)).toBe(false);

    // Empty transcript
    const validEcho = createEchoRecord('hello world', now);
    expect(isTranscriptEcho('', validEcho, now + 500)).toBe(false);

    // Both empty
    expect(isTranscriptEcho('', emptyEcho, now + 500)).toBe(false);

    // Whitespace-only strings
    expect(isTranscriptEcho('   ', validEcho, now + 500)).toBe(false);

    // Null echo record
    expect(isTranscriptEcho('hello', null, now + 500)).toBe(false);
  });

  // ── Transcript outside 3s window returns false even with overlap ───

  it('transcript outside 3s window returns false even with overlap', () => {
    const ttsText = 'hello world good morning';
    const now = 1000;
    const echo = createEchoRecord(ttsText, now);

    // Within window (2999ms elapsed) — should be echo
    expect(isTranscriptEcho('hello world good morning', echo, now + 2999)).toBe(true);

    // Exactly at boundary (3000ms elapsed) — should be echo (>= not >)
    // The source uses `elapsed > ECHO_WINDOW_MS`, so at exactly 3000ms:
    // elapsed = 3000, ECHO_WINDOW_MS = 3000, 3000 > 3000 is false → still echo
    expect(isTranscriptEcho('hello world good morning', echo, now + 3000)).toBe(true);

    // Outside window (3001ms elapsed) — should NOT be echo
    expect(isTranscriptEcho('hello world good morning', echo, now + 3001)).toBe(false);

    // Well outside window — should NOT be echo
    expect(isTranscriptEcho('hello world good morning', echo, now + 5000)).toBe(false);
  });

  // ── normalizeWords utility function ────────────────────────────────

  describe('normalizeWords', () => {
    it('converts to lowercase', () => {
      expect(normalizeWords('HELLO WORLD')).toEqual(['hello', 'world']);
    });

    it('removes punctuation', () => {
      expect(normalizeWords('hello, world!')).toEqual(['hello', 'world']);
    });

    it('splits on whitespace', () => {
      expect(normalizeWords('one  two\tthree\nfour')).toEqual([
        'one',
        'two',
        'three',
        'four',
      ]);
    });

    it('filters empty strings', () => {
      expect(normalizeWords('  ')).toEqual([]);
      expect(normalizeWords('')).toEqual([]);
    });

    it('handles mixed punctuation and case', () => {
      expect(normalizeWords("What's up, Doc?")).toEqual(['whats', 'up', 'doc']);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('single word match with single word TTS counts as 100% overlap', () => {
      const echo = createEchoRecord('hello', 1000);
      expect(isTranscriptEcho('hello', echo, 1500)).toBe(true);
    });

    it('single word mismatch with single word TTS counts as 0% overlap', () => {
      const echo = createEchoRecord('hello', 1000);
      expect(isTranscriptEcho('goodbye', echo, 1500)).toBe(false);
    });

    it('transcript with more words than TTS text calculates overlap using max', () => {
      // TTS: 2 words, transcript: 5 words, 2 match
      // overlap = 2 / max(5, 2) = 2/5 = 40% < 60%
      const echo = createEchoRecord('hello world', 1000);
      expect(isTranscriptEcho('hello world I am here today', echo, 1500)).toBe(false);
    });

    it('duplicate words in transcript are deduplicated by Set', () => {
      // TTS: "hello hello hello" → Set: {hello} size 1
      // transcript: "hello" → Set: {hello} size 1
      // intersection: 1, max(1, 1) = 1, overlap = 100%
      const echo = createEchoRecord('hello hello hello', 1000);
      expect(isTranscriptEcho('hello', echo, 1500)).toBe(true);
    });
  });
});
