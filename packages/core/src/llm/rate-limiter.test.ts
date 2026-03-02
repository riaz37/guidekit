// ---------------------------------------------------------------------------
// Tests for RateLimiter
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from './rate-limiter.js';
import { ResourceExhaustedError } from '../errors/index.js';
import { EventBus } from '../bus/index.js';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new RateLimiter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Constructor & defaults
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('creates an instance with default limits', () => {
      expect(limiter).toBeInstanceOf(RateLimiter);
    });

    it('defaults to 10 LLM calls per minute', () => {
      // Should allow 10 calls without throwing
      for (let i = 0; i < 10; i++) {
        expect(() => limiter.checkLLMCall()).not.toThrow();
      }
      // 11th should throw
      expect(() => limiter.checkLLMCall()).toThrow(ResourceExhaustedError);
    });

    it('defaults to 60 STT minutes', () => {
      const state = limiter.getState();
      expect(state.sttMinutesUsed).toBe(0);
    });

    it('defaults to 50K TTS chars', () => {
      // Should allow up to 50K
      expect(() => limiter.checkTTS(50_000)).not.toThrow();
      // Any more should throw
      expect(() => limiter.checkTTS(1)).toThrow(ResourceExhaustedError);
    });

    it('accepts custom limits via constructor', () => {
      const custom = new RateLimiter({
        limits: {
          maxLLMCallsPerMinute: 5,
          maxSTTMinutesPerSession: 30,
          maxTTSCharsPerSession: 10_000,
        },
      });

      for (let i = 0; i < 5; i++) {
        expect(() => custom.checkLLMCall()).not.toThrow();
      }
      expect(() => custom.checkLLMCall()).toThrow(ResourceExhaustedError);
    });
  });

  // -----------------------------------------------------------------------
  // LLM rate limiting
  // -----------------------------------------------------------------------

  describe('checkLLMCall()', () => {
    it('records a call and allows it when under limit', () => {
      expect(() => limiter.checkLLMCall()).not.toThrow();
      expect(limiter.getState().llmCallsInWindow).toBe(1);
    });

    it('throws ResourceExhaustedError when limit is exceeded', () => {
      for (let i = 0; i < 10; i++) {
        limiter.checkLLMCall();
      }

      expect(() => limiter.checkLLMCall()).toThrow(ResourceExhaustedError);
    });

    it('error message mentions rate limit', () => {
      for (let i = 0; i < 10; i++) {
        limiter.checkLLMCall();
      }

      try {
        limiter.checkLLMCall();
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ResourceExhaustedError);
        expect((err as ResourceExhaustedError).message).toContain('rate limit');
      }
    });

    it('prunes old calls outside the 1-minute sliding window', () => {
      // Make 10 calls at t=0
      for (let i = 0; i < 10; i++) {
        limiter.checkLLMCall();
      }
      expect(() => limiter.checkLLMCall()).toThrow();

      // Advance past the 1-minute window
      vi.advanceTimersByTime(61_000);

      // Old calls should be pruned, allowing new ones
      expect(() => limiter.checkLLMCall()).not.toThrow();
    });

    it('sliding window removes only expired calls', () => {
      // Make 5 calls at t=0
      for (let i = 0; i < 5; i++) {
        limiter.checkLLMCall();
      }

      // Advance 30s and make 5 more
      vi.advanceTimersByTime(30_000);
      for (let i = 0; i < 5; i++) {
        limiter.checkLLMCall();
      }

      // At t=30s, all 10 calls are in the window
      expect(() => limiter.checkLLMCall()).toThrow();

      // Advance to t=61s — the first 5 calls (from t=0) should be pruned
      vi.advanceTimersByTime(31_000);

      // Now only 5 calls from t=30s remain, should allow 5 more
      expect(() => limiter.checkLLMCall()).not.toThrow();
      expect(limiter.getState().llmCallsInWindow).toBe(6); // 5 remaining + 1 new
    });

    it('tracks call count accurately in state', () => {
      limiter.checkLLMCall();
      limiter.checkLLMCall();
      limiter.checkLLMCall();

      expect(limiter.getState().llmCallsInWindow).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // STT rate limiting
  // -----------------------------------------------------------------------

  describe('sttStart() / sttStop()', () => {
    it('tracks STT usage duration', () => {
      limiter.sttStart();
      vi.advanceTimersByTime(30_000); // 30 seconds
      limiter.sttStop();

      const state = limiter.getState();
      expect(state.sttMinutesUsed).toBeCloseTo(0.5, 1);
    });

    it('sttStart is idempotent when already streaming', () => {
      limiter.sttStart();
      vi.advanceTimersByTime(10_000);
      limiter.sttStart(); // should be no-op
      vi.advanceTimersByTime(20_000);
      limiter.sttStop();

      // Should be 30 seconds total, not 20
      const state = limiter.getState();
      expect(state.sttMinutesUsed).toBeCloseTo(0.5, 1);
    });

    it('sttStop is a no-op when not streaming', () => {
      limiter.sttStop();
      expect(limiter.getState().sttMinutesUsed).toBe(0);
    });

    it('accumulates across multiple start/stop cycles', () => {
      limiter.sttStart();
      vi.advanceTimersByTime(60_000); // 1 minute
      limiter.sttStop();

      limiter.sttStart();
      vi.advanceTimersByTime(60_000); // 1 minute
      limiter.sttStop();

      expect(limiter.getState().sttMinutesUsed).toBeCloseTo(2, 1);
    });
  });

  describe('checkSTT()', () => {
    it('does not throw when under limit', () => {
      limiter.sttStart();
      vi.advanceTimersByTime(60_000); // 1 minute
      limiter.sttStop();

      expect(() => limiter.checkSTT()).not.toThrow();
    });

    it('throws ResourceExhaustedError when STT minutes exceeded', () => {
      const custom = new RateLimiter({
        limits: { maxSTTMinutesPerSession: 1 },
      });

      custom.sttStart();
      vi.advanceTimersByTime(61_000); // slightly over 1 minute
      custom.sttStop();

      expect(() => custom.checkSTT()).toThrow(ResourceExhaustedError);
    });

    it('includes active streaming time in check', () => {
      const custom = new RateLimiter({
        limits: { maxSTTMinutesPerSession: 1 },
      });

      custom.sttStart();
      vi.advanceTimersByTime(61_000); // over 1 min while still streaming

      expect(() => custom.checkSTT()).toThrow(ResourceExhaustedError);
    });

    it('stops the clock when STT exceeds limit during check', () => {
      const custom = new RateLimiter({
        limits: { maxSTTMinutesPerSession: 1 },
      });

      custom.sttStart();
      vi.advanceTimersByTime(120_000); // 2 minutes

      try {
        custom.checkSTT();
      } catch {
        // Expected
      }

      // sttStop should have been called, state should show no active stream time increasing
      const state1 = custom.getState();
      vi.advanceTimersByTime(60_000);
      const state2 = custom.getState();

      expect(state1.sttMinutesUsed).toBeCloseTo(state2.sttMinutesUsed, 1);
    });
  });

  // -----------------------------------------------------------------------
  // TTS rate limiting
  // -----------------------------------------------------------------------

  describe('checkTTS()', () => {
    it('records character usage', () => {
      limiter.checkTTS(1_000);
      expect(limiter.getState().ttsCharsUsed).toBe(1_000);
    });

    it('accumulates character usage', () => {
      limiter.checkTTS(10_000);
      limiter.checkTTS(15_000);
      expect(limiter.getState().ttsCharsUsed).toBe(25_000);
    });

    it('throws ResourceExhaustedError when limit exceeded', () => {
      limiter.checkTTS(40_000);
      expect(() => limiter.checkTTS(11_000)).toThrow(ResourceExhaustedError);
    });

    it('does not record chars when check fails', () => {
      limiter.checkTTS(40_000);
      try {
        limiter.checkTTS(11_000);
      } catch {
        // Expected
      }
      expect(limiter.getState().ttsCharsUsed).toBe(40_000);
    });

    it('allows exactly max chars', () => {
      expect(() => limiter.checkTTS(50_000)).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // getState()
  // -----------------------------------------------------------------------

  describe('getState()', () => {
    it('returns current usage state', () => {
      const state = limiter.getState();
      expect(state).toHaveProperty('llmCallsInWindow');
      expect(state).toHaveProperty('sttMinutesUsed');
      expect(state).toHaveProperty('ttsCharsUsed');
      expect(state).toHaveProperty('llmWindowStart');
    });

    it('returns zero values initially', () => {
      const state = limiter.getState();
      expect(state.llmCallsInWindow).toBe(0);
      expect(state.sttMinutesUsed).toBe(0);
      expect(state.ttsCharsUsed).toBe(0);
    });

    it('reflects LLM calls in window', () => {
      limiter.checkLLMCall();
      limiter.checkLLMCall();
      expect(limiter.getState().llmCallsInWindow).toBe(2);
    });

    it('filters expired LLM calls from state', () => {
      limiter.checkLLMCall();
      vi.advanceTimersByTime(61_000);
      expect(limiter.getState().llmCallsInWindow).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // setLimits()
  // -----------------------------------------------------------------------

  describe('setLimits()', () => {
    it('updates LLM limit at runtime', () => {
      limiter.setLimits({ maxLLMCallsPerMinute: 3 });

      limiter.checkLLMCall();
      limiter.checkLLMCall();
      limiter.checkLLMCall();
      expect(() => limiter.checkLLMCall()).toThrow(ResourceExhaustedError);
    });

    it('updates STT limit at runtime', () => {
      limiter.setLimits({ maxSTTMinutesPerSession: 0.5 });

      limiter.sttStart();
      vi.advanceTimersByTime(31_000); // slightly over 0.5 min
      limiter.sttStop();

      expect(() => limiter.checkSTT()).toThrow(ResourceExhaustedError);
    });

    it('updates TTS limit at runtime', () => {
      limiter.setLimits({ maxTTSCharsPerSession: 100 });

      expect(() => limiter.checkTTS(101)).toThrow(ResourceExhaustedError);
    });

    it('only updates specified limits, leaving others unchanged', () => {
      limiter.setLimits({ maxLLMCallsPerMinute: 2 });

      // TTS should still be at 50K default
      expect(() => limiter.checkTTS(50_000)).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // reset()
  // -----------------------------------------------------------------------

  describe('reset()', () => {
    it('clears all counters', () => {
      limiter.checkLLMCall();
      limiter.checkTTS(10_000);
      limiter.sttStart();
      vi.advanceTimersByTime(30_000);
      limiter.sttStop();

      limiter.reset();

      const state = limiter.getState();
      expect(state.llmCallsInWindow).toBe(0);
      expect(state.sttMinutesUsed).toBe(0);
      expect(state.ttsCharsUsed).toBe(0);
    });

    it('allows new calls after reset', () => {
      // Exhaust LLM limit
      for (let i = 0; i < 10; i++) {
        limiter.checkLLMCall();
      }
      expect(() => limiter.checkLLMCall()).toThrow();

      limiter.reset();
      expect(() => limiter.checkLLMCall()).not.toThrow();
    });

    it('stops active STT stream on reset', () => {
      limiter.sttStart();
      vi.advanceTimersByTime(60_000);
      limiter.reset();

      // After reset, no STT usage should be recorded
      expect(limiter.getState().sttMinutesUsed).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // EventBus error emission
  // -----------------------------------------------------------------------

  describe('EventBus integration', () => {
    it('emits error to EventBus on LLM limit exceeded', () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on('error', handler);

      const busLimiter = new RateLimiter({ bus });

      for (let i = 0; i < 10; i++) {
        busLimiter.checkLLMCall();
      }

      try {
        busLimiter.checkLLMCall();
      } catch {
        // Expected
      }

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]![0]).toBeInstanceOf(ResourceExhaustedError);
    });

    it('emits error to EventBus on STT limit exceeded', () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on('error', handler);

      const busLimiter = new RateLimiter({
        bus,
        limits: { maxSTTMinutesPerSession: 0.5 },
      });

      busLimiter.sttStart();
      vi.advanceTimersByTime(31_000);
      busLimiter.sttStop();

      try {
        busLimiter.checkSTT();
      } catch {
        // Expected
      }

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('emits error to EventBus on TTS limit exceeded', () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on('error', handler);

      const busLimiter = new RateLimiter({ bus });

      try {
        busLimiter.checkTTS(60_000);
      } catch {
        // Expected
      }

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not throw when no bus is provided', () => {
      const noBusLimiter = new RateLimiter();
      for (let i = 0; i < 10; i++) {
        noBusLimiter.checkLLMCall();
      }

      // Should still throw the error, just not emit to bus
      expect(() => noBusLimiter.checkLLMCall()).toThrow(ResourceExhaustedError);
    });
  });
});
