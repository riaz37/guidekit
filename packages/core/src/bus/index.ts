// ---------------------------------------------------------------------------
// GuideKit SDK - Typed EventBus
// ---------------------------------------------------------------------------

/**
 * Canonical map of every event in the GuideKit system.
 *
 * Keys use a `namespace:name` convention (except the top-level `error` event).
 * Values are the payload types that accompany each event.
 */
export interface EventMap {
  // -- DOM events -----------------------------------------------------------
  'dom:scan-complete': { pageModel: unknown; durationMs: number };
  'dom:mutation-detected': { mutations: number; debounced: boolean };
  'dom:route-change': { from: string; to: string };

  // -- LLM events -----------------------------------------------------------
  'llm:response-start': { conversationId: string };
  'llm:response-chunk': { text: string; done: boolean };
  'llm:response-end': { conversationId: string; totalTokens: number };
  'llm:tool-call': { name: string; arguments: Record<string, unknown> };
  'llm:token-usage': { prompt: number; completion: number; total: number };

  // -- Voice events ---------------------------------------------------------
  'voice:state-change': { from: string; to: string };
  'voice:transcript': { text: string; isFinal: boolean; confidence: number };
  'voice:tts-start': { utterance: string };
  'voice:tts-end': { utterance: string; durationMs: number };
  'voice:degraded': { reason: string; fallback: 'text' };

  // -- Auth events ----------------------------------------------------------
  'auth:token-refreshed': { expiresAt: number };
  'auth:token-refresh-failed': { error: Error; attemptsRemaining: number };
  'auth:token-expired': Record<string, never>;

  // -- Connectivity events --------------------------------------------------
  'connectivity:state-change': {
    state: 'online' | 'degraded' | 'offline';
    previous: 'online' | 'degraded' | 'offline';
  };

  // -- Awareness events -----------------------------------------------------
  'awareness:dwell': { sectionId: string; durationMs: number };
  'awareness:idle': { durationMs: number };
  'awareness:rage-click': { selector: string; clicks: number };
  'awareness:section-visible': { sectionId: string; ratio: number };

  // -- Visual events --------------------------------------------------------
  'visual:spotlight-shown': { selector: string; sectionId?: string };
  'visual:spotlight-dismissed': Record<string, never>;
  'visual:tour-step': {
    stepIndex: number;
    totalSteps: number;
    sectionId: string;
  };

  // -- Top-level error event ------------------------------------------------
  error: Error;
}

// ---------------------------------------------------------------------------
// Internal helper types
// ---------------------------------------------------------------------------

/** Handler for a concrete, known event key. */
type TypedHandler<K extends keyof EventMap> = (data: EventMap[K]) => void;

/** Handler for a wildcard (namespace) subscription. */
type WildcardHandler = (data: unknown, eventName: string) => void;

/** Discriminated wrapper so we can store both kinds in one map. */
type StoredHandler =
  | { kind: 'typed'; fn: TypedHandler<any> }
  | { kind: 'wildcard'; fn: WildcardHandler };

// ---------------------------------------------------------------------------
// EventBus
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[GuideKit:Bus]';

export class EventBus {
  /** Per-event listeners. Wildcard keys end with `:*`. */
  private readonly listeners = new Map<string, StoredHandler[]>();

  /** Listeners registered via `onAny`. */
  private readonly anyListeners: WildcardHandler[] = [];

  /** When true, every `emit` is logged to the console. */
  private readonly debug: boolean;

  constructor(options?: { debug?: boolean }) {
    this.debug = options?.debug ?? false;
  }

  // ---- on (specific event) ------------------------------------------------

  /**
   * Subscribe to a specific typed event.
   *
   * @returns An unsubscribe function.
   */
  on<K extends keyof EventMap>(
    event: K,
    handler: (data: EventMap[K]) => void,
  ): () => void;

  /**
   * Subscribe to a namespace wildcard (e.g. `'dom:*'`).
   * The handler receives `(data, eventName)`.
   *
   * @returns An unsubscribe function.
   */
  on(
    event: `${string}:*`,
    handler: (data: unknown, eventName: string) => void,
  ): () => void;

  /** Unified implementation. */
  on(event: string, handler: (...args: any[]) => void): () => void {
    const isWildcard = event.endsWith(':*');
    const stored: StoredHandler = isWildcard
      ? { kind: 'wildcard', fn: handler as WildcardHandler }
      : { kind: 'typed', fn: handler as TypedHandler<any> };

    let list = this.listeners.get(event);
    if (!list) {
      list = [];
      this.listeners.set(event, list);
    }
    list.push(stored);

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const arr = this.listeners.get(event);
      if (!arr) return;
      const idx = arr.indexOf(stored);
      if (idx !== -1) arr.splice(idx, 1);
      if (arr.length === 0) this.listeners.delete(event);
    };
  }

  // ---- onAny --------------------------------------------------------------

  /**
   * Subscribe to **every** event emitted on the bus.
   *
   * @returns An unsubscribe function.
   */
  onAny(handler: (data: unknown, eventName: string) => void): () => void {
    this.anyListeners.push(handler);

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const idx = this.anyListeners.indexOf(handler);
      if (idx !== -1) this.anyListeners.splice(idx, 1);
    };
  }

  // ---- emit ---------------------------------------------------------------

  /**
   * Emit a typed event.
   *
   * Handlers are invoked synchronously in registration order. If a handler
   * throws, the error is logged and remaining handlers still execute.
   */
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    if (this.debug) {
      console.log(LOG_PREFIX, event, data);
    }

    const eventKey = event as string;

    // 1. Exact-match listeners
    const exact = this.listeners.get(eventKey);
    if (exact) {
      // Snapshot to avoid issues if a handler adds/removes listeners
      const snapshot = exact.slice();
      for (const entry of snapshot) {
        this.invokeSafe(entry.fn, data, eventKey);
      }
    }

    // 2. Namespace wildcard listeners (e.g. "dom:*" matches "dom:scan-complete")
    const colonIdx = eventKey.indexOf(':');
    if (colonIdx !== -1) {
      const ns = eventKey.slice(0, colonIdx);
      const wildcardKey = `${ns}:*`;
      const wildcardList = this.listeners.get(wildcardKey);
      if (wildcardList) {
        const snapshot = wildcardList.slice();
        for (const entry of snapshot) {
          this.invokeSafe(entry.fn, data, eventKey);
        }
      }
    }

    // 3. `onAny` listeners
    if (this.anyListeners.length > 0) {
      const snapshot = this.anyListeners.slice();
      for (const fn of snapshot) {
        this.invokeSafe(fn, data, eventKey);
      }
    }
  }

  // ---- once ---------------------------------------------------------------

  /**
   * Subscribe to a specific event, automatically unsubscribing after the
   * first invocation.
   *
   * @returns An unsubscribe function (also cancels a not-yet-fired listener).
   */
  once<K extends keyof EventMap>(
    event: K,
    handler: (data: EventMap[K]) => void,
  ): () => void {
    const unsub = this.on(event, ((data: EventMap[K]) => {
      unsub();
      handler(data);
    }) as any);
    return unsub;
  }

  // ---- removeAll ----------------------------------------------------------

  /** Remove **all** listeners from the bus. */
  removeAll(): void {
    this.listeners.clear();
    this.anyListeners.length = 0;
  }

  // ---- listenerCount ------------------------------------------------------

  /**
   * Return the number of registered listeners.
   *
   * - If `event` is provided, returns the count for that specific event key
   *   (including wildcard keys like `'dom:*'`).
   * - If omitted, returns the total across all events plus `onAny` listeners.
   */
  listenerCount(event?: string): number {
    if (event !== undefined) {
      return this.listeners.get(event)?.length ?? 0;
    }

    let total = this.anyListeners.length;
    for (const list of this.listeners.values()) {
      total += list.length;
    }
    return total;
  }

  // ---- private helpers ----------------------------------------------------

  /**
   * Invoke a handler inside a try/catch so one misbehaving handler never
   * prevents the remaining handlers from executing.
   */
  private invokeSafe(fn: (...args: any[]) => void, ...args: any[]): void {
    try {
      fn(...args);
    } catch (err) {
      console.error(
        LOG_PREFIX,
        'Handler threw an error:',
        err,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new {@link EventBus} instance.
 *
 * ```ts
 * const bus = createEventBus({ debug: true });
 * const unsub = bus.on('dom:scan-complete', (data) => {
 *   console.log(data.pageModel, data.durationMs);
 * });
 * bus.emit('dom:scan-complete', { pageModel: {}, durationMs: 42 });
 * unsub();
 * ```
 */
export function createEventBus(options?: { debug?: boolean }): EventBus {
  return new EventBus(options);
}
