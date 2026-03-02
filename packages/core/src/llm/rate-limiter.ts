// ---------------------------------------------------------------------------
// GuideKit SDK – Client-Side Rate Limiter
// ---------------------------------------------------------------------------
//
// Cost-protection guardrails. These limits are trivially bypassable and exist
// solely to:
//   1. Protect users from unexpected costs on BYOK keys
//   2. Prevent runaway SDK loops from burning through API quotas
//
// NOT a security measure — documented as "cost protection, not security".
// ---------------------------------------------------------------------------

import { EventBus } from '../bus/index.js';
import {
  ResourceExhaustedError,
  ErrorCodes,
} from '../errors/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[GuideKit:RateLimiter]';

const DEFAULT_MAX_LLM_CALLS_PER_MINUTE = 10;
const DEFAULT_MAX_STT_MINUTES_PER_SESSION = 60;
const DEFAULT_MAX_TTS_CHARS_PER_SESSION = 50_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimits {
  maxLLMCallsPerMinute?: number;
  maxSTTMinutesPerSession?: number;
  maxTTSCharsPerSession?: number;
}

export interface RateLimiterOptions {
  bus?: EventBus;
  limits?: RateLimits;
  debug?: boolean;
}

export interface RateLimiterState {
  llmCallsInWindow: number;
  sttMinutesUsed: number;
  ttsCharsUsed: number;
  llmWindowStart: number;
}

// ---------------------------------------------------------------------------
// RateLimiter
// ---------------------------------------------------------------------------

export class RateLimiter {
  private readonly bus: EventBus | null;
  private readonly debug: boolean;

  // Configurable limits
  private maxLLMCallsPerMinute: number;
  private maxSTTMinutesPerSession: number;
  private maxTTSCharsPerSession: number;

  // LLM: sliding window (timestamps of recent calls)
  private llmCallTimestamps: number[] = [];

  // STT: cumulative session total (milliseconds for precision)
  private sttMs = 0;
  private sttStartedAt: number | null = null;

  // TTS: cumulative session total (characters)
  private ttsChars = 0;

  constructor(options?: RateLimiterOptions) {
    this.bus = options?.bus ?? null;
    this.debug = options?.debug ?? false;

    const limits = options?.limits;
    this.maxLLMCallsPerMinute =
      limits?.maxLLMCallsPerMinute ?? DEFAULT_MAX_LLM_CALLS_PER_MINUTE;
    this.maxSTTMinutesPerSession =
      limits?.maxSTTMinutesPerSession ?? DEFAULT_MAX_STT_MINUTES_PER_SESSION;
    this.maxTTSCharsPerSession =
      limits?.maxTTSCharsPerSession ?? DEFAULT_MAX_TTS_CHARS_PER_SESSION;
  }

  // -------------------------------------------------------------------------
  // LLM rate limiting
  // -------------------------------------------------------------------------

  /**
   * Check whether an LLM call is allowed. If allowed, records the call.
   * Throws `ResourceExhaustedError` if the limit is exceeded.
   */
  checkLLMCall(): void {
    const now = Date.now();
    const windowStart = now - 60_000;

    // Prune timestamps outside the 1-minute window
    this.llmCallTimestamps = this.llmCallTimestamps.filter(
      (t) => t > windowStart,
    );

    if (this.llmCallTimestamps.length >= this.maxLLMCallsPerMinute) {
      const err = new ResourceExhaustedError({
        code: ErrorCodes.RATE_LIMIT_CLIENT,
        message: `LLM rate limit exceeded: ${this.maxLLMCallsPerMinute} calls per minute.`,
        suggestion: `Wait a moment before sending another message, or increase rateLimits.maxLLMCallsPerMinute.`,
      });
      this.emitError(err);
      throw err;
    }

    this.llmCallTimestamps.push(now);
    this.log('LLM call recorded', {
      count: this.llmCallTimestamps.length,
      max: this.maxLLMCallsPerMinute,
    });
  }

  // -------------------------------------------------------------------------
  // STT rate limiting
  // -------------------------------------------------------------------------

  /** Call when STT streaming starts. */
  sttStart(): void {
    if (this.sttStartedAt !== null) return; // already streaming
    this.sttStartedAt = Date.now();
    this.log('STT streaming started');
  }

  /** Call when STT streaming stops. Accumulates duration. */
  sttStop(): void {
    if (this.sttStartedAt === null) return;
    const elapsed = Date.now() - this.sttStartedAt;
    this.sttMs += elapsed;
    this.sttStartedAt = null;
    this.log('STT streaming stopped', {
      elapsedMs: elapsed,
      totalMinutes: this.sttMinutesUsed,
    });
  }

  /**
   * Check whether STT streaming is within limits.
   * Throws `ResourceExhaustedError` if exceeded.
   */
  checkSTT(): void {
    const totalMinutes = this.sttMinutesUsed;
    if (totalMinutes >= this.maxSTTMinutesPerSession) {
      this.sttStop(); // stop the clock
      const err = new ResourceExhaustedError({
        code: ErrorCodes.RATE_LIMIT_CLIENT,
        message: `STT session limit exceeded: ${this.maxSTTMinutesPerSession} minutes per session.`,
        suggestion: `Voice input limit reached. Use text input, or increase rateLimits.maxSTTMinutesPerSession.`,
      });
      this.emitError(err);
      throw err;
    }
  }

  /** Current STT minutes used (including active stream). */
  private get sttMinutesUsed(): number {
    let totalMs = this.sttMs;
    if (this.sttStartedAt !== null) {
      const activeMs = Date.now() - this.sttStartedAt;
      const maxSessionMs = this.maxSTTMinutesPerSession * 60_000;
      const maxActiveMs = maxSessionMs * 2;

      if (activeMs > maxActiveMs) {
        console.warn(
          `${LOG_PREFIX} STT stream running for ${Math.round(activeMs / 60_000)}min without sttStop() — ` +
          `capping at 2x session limit (${this.maxSTTMinutesPerSession * 2}min).`,
        );
        // Auto-cap: freeze the accumulated time and clear the start marker
        this.sttMs += maxActiveMs;
        this.sttStartedAt = null;
        totalMs = this.sttMs;
      } else {
        totalMs += activeMs;
      }
    }
    return totalMs / 60_000;
  }

  // -------------------------------------------------------------------------
  // TTS rate limiting
  // -------------------------------------------------------------------------

  /**
   * Record TTS character usage. Throws `ResourceExhaustedError` if limit exceeded.
   */
  checkTTS(charCount: number): void {
    if (this.ttsChars + charCount > this.maxTTSCharsPerSession) {
      const err = new ResourceExhaustedError({
        code: ErrorCodes.RATE_LIMIT_CLIENT,
        message: `TTS character limit exceeded: ${this.maxTTSCharsPerSession} characters per session.`,
        suggestion: `Voice output limit reached. Responses will be text-only, or increase rateLimits.maxTTSCharsPerSession.`,
      });
      this.emitError(err);
      throw err;
    }

    this.ttsChars += charCount;
    this.log('TTS chars recorded', {
      added: charCount,
      total: this.ttsChars,
      max: this.maxTTSCharsPerSession,
    });
  }

  // -------------------------------------------------------------------------
  // State & config
  // -------------------------------------------------------------------------

  /** Get the current rate limiter state for monitoring. */
  getState(): RateLimiterState {
    const now = Date.now();
    const windowStart = now - 60_000;
    return {
      llmCallsInWindow: this.llmCallTimestamps.filter((t) => t > windowStart)
        .length,
      sttMinutesUsed: Math.round(this.sttMinutesUsed * 100) / 100,
      ttsCharsUsed: this.ttsChars,
      llmWindowStart: windowStart,
    };
  }

  /** Update limits at runtime. */
  setLimits(limits: RateLimits): void {
    if (limits.maxLLMCallsPerMinute !== undefined) {
      this.maxLLMCallsPerMinute = limits.maxLLMCallsPerMinute;
    }
    if (limits.maxSTTMinutesPerSession !== undefined) {
      this.maxSTTMinutesPerSession = limits.maxSTTMinutesPerSession;
    }
    if (limits.maxTTSCharsPerSession !== undefined) {
      this.maxTTSCharsPerSession = limits.maxTTSCharsPerSession;
    }
    this.log('Limits updated', limits);
  }

  /** Reset all counters (e.g., for testing or new session). */
  reset(): void {
    this.llmCallTimestamps = [];
    this.sttMs = 0;
    this.sttStartedAt = null;
    this.ttsChars = 0;
    this.log('Counters reset');
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private emitError(err: ResourceExhaustedError): void {
    if (this.bus) {
      this.bus.emit('error', err);
    }
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.debug(LOG_PREFIX, ...args);
    }
  }
}
