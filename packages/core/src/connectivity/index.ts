// ---------------------------------------------------------------------------
// GuideKit SDK – Network Connectivity Manager
// ---------------------------------------------------------------------------

import type { ConnectionState } from '../types/index.js';

const LOG_PREFIX = '[GuideKit:Connectivity]';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of messages held in the offline queue. */
const MAX_QUEUE_SIZE = 5;

/** Number of recent pings used to compute rolling average latency. */
const ROLLING_WINDOW = 3;

/** Latency threshold (ms) above which the connection is considered degraded. */
const DEGRADED_THRESHOLD_MS = 2_000;

/** Ping intervals per state (ms). */
const PING_INTERVALS: Record<ConnectionState, number> = {
  online: 30_000,
  degraded: 5_000,
  offline: 10_000,
};

/** Timeout applied to each health-check fetch (ms). */
const PING_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// QueuedMessage
// ---------------------------------------------------------------------------

/** A message held for replay once connectivity is restored. */
export interface QueuedMessage {
  content: string;
  timestamp: number;
  pageUrl: string;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ConnectionManagerOptions {
  /** Server endpoint for lightweight health-check pings. */
  healthEndpoint?: string;
  /** When `true`, diagnostic messages are logged to the console. */
  debug?: boolean;
}

// ---------------------------------------------------------------------------
// State-change subscriber
// ---------------------------------------------------------------------------

type StateChangeCallback = (
  state: ConnectionState,
  previous: ConnectionState,
) => void;

// ---------------------------------------------------------------------------
// ConnectionManager
// ---------------------------------------------------------------------------

/**
 * Monitors network connectivity and exposes a reactive {@link ConnectionState}.
 *
 * Strategy:
 * 1. Listen to `window.online` / `window.offline` events (coarse signal).
 * 2. Periodically ping the configured `healthEndpoint` (fine-grained signal).
 * 3. Compute a rolling average of the last {@link ROLLING_WINDOW} ping
 *    latencies to detect degraded connections (> {@link DEGRADED_THRESHOLD_MS}).
 * 4. When fully offline (`navigator.onLine === false`), suspend pinging and
 *    wait for the browser's `online` event before resuming.
 *
 * All browser APIs are gated behind `typeof window !== 'undefined'` so the
 * class can be safely imported (though not meaningfully used) in SSR contexts.
 */
export class ConnectionManager {
  // ---- Configuration ------------------------------------------------------

  private readonly healthEndpoint: string | undefined;
  private readonly debugEnabled: boolean;

  // ---- Internal state -----------------------------------------------------

  private _state: ConnectionState = 'online';
  private _running = false;

  /** Rolling window of recent ping latencies (ms). */
  private readonly pingLatencies: number[] = [];

  /** Queued messages awaiting replay on reconnect. */
  private readonly messageQueue: QueuedMessage[] = [];

  /** Registered state-change subscribers. */
  private readonly subscribers: Set<StateChangeCallback> = new Set();

  /** Timer handle for the periodic ping loop. */
  private pingTimer: ReturnType<typeof setTimeout> | null = null;

  /** Bound event handlers (stored for deterministic removal). */
  private readonly handleOnline: () => void;
  private readonly handleOffline: () => void;

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(options?: ConnectionManagerOptions) {
    this.healthEndpoint = options?.healthEndpoint;
    this.debugEnabled = options?.debug ?? false;

    // Pre-bind handlers so we can add/remove the exact same references.
    this.handleOnline = this.onBrowserOnline.bind(this);
    this.handleOffline = this.onBrowserOffline.bind(this);

    this.log('ConnectionManager created');
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Current connection state. */
  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Start monitoring connectivity.
   *
   * Attaches browser event listeners and begins the periodic ping loop.
   * Calling `start()` when already running is a no-op.
   */
  start(): void {
    if (this._running) {
      return;
    }

    this._running = true;
    this.log('Monitoring started');

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);

      // Seed initial state from the browser.
      if (!navigator.onLine) {
        this.transition('offline');
      }
    }

    this.schedulePing();
  }

  /**
   * Stop monitoring connectivity.
   *
   * Removes all event listeners, clears timers, and resets internal state.
   */
  stop(): void {
    if (!this._running) {
      return;
    }

    this._running = false;
    this.log('Monitoring stopped');

    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }

    this.clearPingTimer();
    this.pingLatencies.length = 0;
  }

  /**
   * Subscribe to connection state changes.
   *
   * @returns An unsubscribe function. Calling it more than once is safe.
   */
  onStateChange(callback: StateChangeCallback): () => void {
    this.subscribers.add(callback);

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.subscribers.delete(callback);
    };
  }

  /**
   * Queue a message for replay once the connection is restored.
   *
   * The queue is capped at {@link MAX_QUEUE_SIZE} messages. When the cap is
   * exceeded the oldest message is discarded.
   */
  queueMessage(message: QueuedMessage): void {
    if (this.messageQueue.length >= MAX_QUEUE_SIZE) {
      const discarded = this.messageQueue.shift();
      this.log('Queue full — discarded oldest message', discarded);
    }

    this.messageQueue.push(message);
    this.log(`Message queued (${this.messageQueue.length}/${MAX_QUEUE_SIZE})`);
  }

  /**
   * Drain the message queue and return its contents.
   *
   * Messages whose `pageUrl` no longer matches the current browser URL are
   * silently discarded (the user has navigated away since queueing).
   */
  drainQueue(): QueuedMessage[] {
    const currentUrl = this.getCurrentUrl();
    const valid: QueuedMessage[] = [];

    for (const msg of this.messageQueue) {
      if (msg.pageUrl === currentUrl) {
        valid.push(msg);
      } else {
        this.log('Discarded stale message (URL changed)', msg.pageUrl);
      }
    }

    this.messageQueue.length = 0;
    this.log(`Drained ${valid.length} message(s)`);
    return valid;
  }

  /**
   * Force an immediate connectivity check.
   *
   * @returns The updated {@link ConnectionState} after the check completes.
   */
  async checkNow(): Promise<ConnectionState> {
    // If the browser reports offline, skip the network request entirely.
    if (typeof window !== 'undefined' && !navigator.onLine) {
      this.transition('offline');
      return this._state;
    }

    await this.ping();
    return this._state;
  }

  // -----------------------------------------------------------------------
  // Browser event handlers
  // -----------------------------------------------------------------------

  private onBrowserOnline(): void {
    this.log('Browser "online" event received');

    // Reset latency history — the previous measurements are stale.
    this.pingLatencies.length = 0;

    // Optimistically assume online; the next ping will refine the state.
    this.transition('online');

    // Resume pinging if we are still in monitoring mode.
    if (this._running) {
      this.schedulePing();
    }
  }

  private onBrowserOffline(): void {
    this.log('Browser "offline" event received');
    this.transition('offline');

    // Suspend pinging — no point hitting the network when the browser
    // itself says we are offline. We will resume via `handleOnline`.
    this.clearPingTimer();
  }

  // -----------------------------------------------------------------------
  // Ping logic
  // -----------------------------------------------------------------------

  /**
   * Execute a single health-check ping and update state accordingly.
   */
  private async ping(): Promise<void> {
    if (!this.healthEndpoint) {
      // Without an endpoint we can only rely on navigator.onLine.
      if (typeof window !== 'undefined') {
        this.transition(navigator.onLine ? 'online' : 'offline');
      }
      return;
    }

    const start = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

      try {
        await fetch(this.healthEndpoint, {
          method: 'HEAD',
          mode: 'no-cors',
          cache: 'no-store',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      const latency = Date.now() - start;
      this.recordLatency(latency);
      this.log(`Ping OK (${latency}ms)`);

      // Evaluate rolling average to decide between online / degraded.
      const avg = this.rollingAverage();
      if (avg > DEGRADED_THRESHOLD_MS) {
        this.transition('degraded');
      } else {
        this.transition('online');
      }
    } catch {
      this.log('Ping failed');

      // A failed ping when navigator reports offline is a clear offline.
      if (typeof window !== 'undefined' && !navigator.onLine) {
        this.transition('offline');
      } else {
        // Network may still be up, but the endpoint is unreachable —
        // treat as degraded rather than outright offline.
        this.transition('degraded');
      }
    }
  }

  /**
   * Record a latency sample, keeping only the last {@link ROLLING_WINDOW}
   * entries.
   */
  private recordLatency(ms: number): void {
    this.pingLatencies.push(ms);
    if (this.pingLatencies.length > ROLLING_WINDOW) {
      this.pingLatencies.shift();
    }
  }

  /** Compute the arithmetic mean of recorded latencies. */
  private rollingAverage(): number {
    if (this.pingLatencies.length === 0) return 0;

    let sum = 0;
    for (const v of this.pingLatencies) {
      sum += v;
    }
    return sum / this.pingLatencies.length;
  }

  // -----------------------------------------------------------------------
  // Ping scheduling
  // -----------------------------------------------------------------------

  /**
   * Schedule the next ping according to the current state's interval.
   *
   * When in the `offline` state, pinging is suspended entirely — the
   * manager waits for the browser's `online` event to resume.
   */
  private schedulePing(): void {
    this.clearPingTimer();

    if (!this._running) {
      return;
    }

    // While offline, do not ping. The browser `online` event will resume.
    if (this._state === 'offline') {
      return;
    }

    const interval = PING_INTERVALS[this._state];

    this.pingTimer = setTimeout(async () => {
      if (!this._running) return;

      await this.ping();

      // Schedule the next iteration (interval may have changed due to
      // a state transition during the ping).
      this.schedulePing();
    }, interval);
  }

  private clearPingTimer(): void {
    if (this.pingTimer !== null) {
      clearTimeout(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // State transitions
  // -----------------------------------------------------------------------

  /**
   * Transition to a new state, notifying subscribers if the state actually
   * changed.
   */
  private transition(next: ConnectionState): void {
    const previous = this._state;
    if (previous === next) {
      return;
    }

    this._state = next;
    this.log(`State: ${previous} -> ${next}`);

    // Notify subscribers. Errors in callbacks are caught so one bad
    // subscriber does not prevent the rest from being notified.
    for (const cb of this.subscribers) {
      try {
        cb(next, previous);
      } catch (err) {
        console.error(LOG_PREFIX, 'Subscriber threw an error:', err);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Return the current page URL, or an empty string in SSR contexts. */
  private getCurrentUrl(): string {
    if (typeof window !== 'undefined') {
      return window.location.href;
    }
    return '';
  }

  /** Conditional debug logging. */
  private log(...args: unknown[]): void {
    if (this.debugEnabled) {
      console.debug(LOG_PREFIX, ...args);
    }
  }
}
