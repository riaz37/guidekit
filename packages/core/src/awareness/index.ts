// ---------------------------------------------------------------------------
// GuideKit SDK – User Awareness System
// ---------------------------------------------------------------------------
// Monitors user behavior signals (scroll, dwell, idle, rage-click, section
// visibility) and emits awareness events via the EventBus.
// ---------------------------------------------------------------------------

import { EventBus } from '../bus/index.js';

const LOG_PREFIX = '[GuideKit:Awareness]';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const DEFAULT_DWELL_TIMEOUT_MS = 8_000;
const DEFAULT_RAGE_CLICK_THRESHOLD = 3;
const DEFAULT_RAGE_CLICK_WINDOW_MS = 2_000;
const RAGE_CLICK_RADIUS_PX = 50;
const MOUSE_THROTTLE_MS = 200;

/** Selectors used to discover observable sections. */
const SECTION_SELECTOR = [
  '[data-guidekit-target]',
  '[id]',
  'main',
  'section',
  'article',
  'aside',
  'nav',
  'header',
  'footer',
].join(', ');

/** IntersectionObserver thresholds for section visibility. */
const IO_THRESHOLDS: number[] = [0, 0.25, 0.5, 0.75, 1.0];

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface AwarenessOptions {
  bus: EventBus;
  rootElement?: HTMLElement;
  idleTimeoutMs?: number;
  dwellTimeoutMs?: number;
  rageClickThreshold?: number;
  rageClickWindowMs?: number;
  debug?: boolean;
}

export interface AwarenessState {
  scrollPercent: number;
  scrollDirection: 'up' | 'down' | 'none';
  focusedSectionId: string | null;
  focusedSectionDwellMs: number;
  isIdle: boolean;
  lastInteractionAt: number;
  visibleSections: Map<string, number>;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ClickRecord {
  x: number;
  y: number;
  timestamp: number;
  target: Element;
}

// ---------------------------------------------------------------------------
// AwarenessSystem
// ---------------------------------------------------------------------------

/**
 * Observes user interactions with the page and emits structured awareness
 * events on the shared {@link EventBus}.
 *
 * All browser API usage is gated behind `typeof window !== 'undefined'` so
 * the module can be safely imported in SSR contexts.
 */
export class AwarenessSystem {
  // ---- Configuration ------------------------------------------------------

  private readonly bus: EventBus;
  private readonly rootElement: HTMLElement | undefined;
  private readonly idleTimeoutMs: number;
  private readonly dwellTimeoutMs: number;
  private readonly rageClickThreshold: number;
  private readonly rageClickWindowMs: number;
  private readonly debugEnabled: boolean;

  // ---- Runtime state ------------------------------------------------------

  private running = false;

  /** AbortController whose signal is passed to every addEventListener call. */
  private abortController: AbortController | null = null;

  /** IntersectionObserver for section visibility tracking. */
  private sectionObserver: IntersectionObserver | null = null;

  /** Section id -> current visibility ratio. */
  private readonly visibleSections = new Map<string, number>();

  // ---- Scroll tracking ----------------------------------------------------

  private scrollPercent = 0;
  private scrollDirection: 'up' | 'down' | 'none' = 'none';
  private lastScrollY = 0;
  private scrollRafPending = false;

  // ---- Dwell detection ----------------------------------------------------

  private focusedSectionId: string | null = null;
  private focusedSectionSince = 0;
  private dwellTimer: ReturnType<typeof setInterval> | null = null;
  private dwellEmitted = false;

  // ---- Idle detection -----------------------------------------------------

  private lastInteractionAt = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private isIdle = false;

  // ---- Rage click detection -----------------------------------------------

  private readonly recentClicks: ClickRecord[] = [];

  // ---- Mouse throttle -----------------------------------------------------

  private lastMouseMoveAt = 0;

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(options: AwarenessOptions) {
    this.bus = options.bus;
    this.rootElement = options.rootElement;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.dwellTimeoutMs = options.dwellTimeoutMs ?? DEFAULT_DWELL_TIMEOUT_MS;
    this.rageClickThreshold = options.rageClickThreshold ?? DEFAULT_RAGE_CLICK_THRESHOLD;
    this.rageClickWindowMs = options.rageClickWindowMs ?? DEFAULT_RAGE_CLICK_WINDOW_MS;
    this.debugEnabled = options.debug ?? false;

    this.log('AwarenessSystem created');
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Begin observing user behavior. No-op if already running or in SSR. */
  start(): void {
    if (this.running) return;
    if (typeof window === 'undefined') {
      this.log('SSR environment detected — start() is a no-op');
      return;
    }

    this.running = true;
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    this.lastInteractionAt = Date.now();
    this.lastScrollY = window.scrollY;

    // -- Event listeners (all using the shared AbortController signal) -----
    const listenerOpts = { signal, passive: true } as const;

    window.addEventListener('scroll', this.handleScroll, listenerOpts);
    window.addEventListener('mousemove', this.handleMouseMove, listenerOpts);
    window.addEventListener('keydown', this.handleInteraction, listenerOpts);
    window.addEventListener('click', this.handleClick, { signal });
    window.addEventListener('touchstart', this.handleInteraction, listenerOpts);
    window.addEventListener('touchend', this.handleInteraction, listenerOpts);

    // -- IntersectionObserver for sections ---------------------------------
    this.initSectionObserver();

    // -- Idle timer --------------------------------------------------------
    this.scheduleIdleTimer();

    // -- Dwell check interval ---------------------------------------------
    this.dwellTimer = setInterval(this.checkDwell, 1_000);

    this.log('Monitoring started');
  }

  /** Stop all observers and listeners. */
  stop(): void {
    if (!this.running) return;

    this.running = false;

    // Abort all listeners in one call.
    this.abortController?.abort();
    this.abortController = null;

    // Tear down IntersectionObserver.
    if (this.sectionObserver) {
      this.sectionObserver.disconnect();
      this.sectionObserver = null;
    }

    // Clear timers.
    this.clearIdleTimer();
    this.clearDwellTimer();

    // Reset state.
    this.visibleSections.clear();
    this.recentClicks.length = 0;
    this.focusedSectionId = null;
    this.focusedSectionSince = 0;
    this.dwellEmitted = false;
    this.isIdle = false;
    this.scrollPercent = 0;
    this.scrollDirection = 'none';
    this.scrollRafPending = false;

    this.log('Monitoring stopped');
  }

  /** Alias for {@link stop}. */
  destroy(): void {
    this.stop();
  }

  /** Return a snapshot of the current awareness state. */
  getState(): AwarenessState {
    const now = Date.now();
    const dwellMs =
      this.focusedSectionId !== null
        ? now - this.focusedSectionSince
        : 0;

    return {
      scrollPercent: this.scrollPercent,
      scrollDirection: this.scrollDirection,
      focusedSectionId: this.focusedSectionId,
      focusedSectionDwellMs: dwellMs,
      isIdle: this.isIdle,
      lastInteractionAt: this.lastInteractionAt,
      visibleSections: new Map(this.visibleSections),
    };
  }

  // -----------------------------------------------------------------------
  // Scroll tracking
  // -----------------------------------------------------------------------

  private readonly handleScroll = (): void => {
    this.recordInteraction();

    if (this.scrollRafPending) return;
    this.scrollRafPending = true;

    requestAnimationFrame(() => {
      this.scrollRafPending = false;
      if (!this.running) return;

      const y = window.scrollY;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      this.scrollPercent = maxScroll > 0 ? Math.min(1, y / maxScroll) : 0;

      if (y > this.lastScrollY) {
        this.scrollDirection = 'down';
      } else if (y < this.lastScrollY) {
        this.scrollDirection = 'up';
      }
      // If y === lastScrollY, keep the current direction.

      this.lastScrollY = y;
    });
  };

  // -----------------------------------------------------------------------
  // Mouse tracking (throttled)
  // -----------------------------------------------------------------------

  private readonly handleMouseMove = (): void => {
    const now = Date.now();
    if (now - this.lastMouseMoveAt < MOUSE_THROTTLE_MS) return;
    this.lastMouseMoveAt = now;

    this.recordInteraction();
  };

  // -----------------------------------------------------------------------
  // Click tracking & rage click detection
  // -----------------------------------------------------------------------

  private readonly handleClick = (e: Event): void => {
    this.recordInteraction();

    const mouseEvent = e as MouseEvent;
    const target = mouseEvent.target as Element | null;
    if (!target) return;

    const now = Date.now();
    const record: ClickRecord = {
      x: mouseEvent.clientX,
      y: mouseEvent.clientY,
      timestamp: now,
      target,
    };

    this.recentClicks.push(record);

    // Prune clicks outside the rage-click time window.
    const windowStart = now - this.rageClickWindowMs;
    while (this.recentClicks.length > 0 && this.recentClicks[0]!.timestamp < windowStart) {
      this.recentClicks.shift();
    }

    // Check for rage clicks: N+ clicks within the window on the same
    // element or within a small radius.
    const nearby = this.recentClicks.filter((c) => {
      const sameElement = c.target === target;
      const dx = c.x - record.x;
      const dy = c.y - record.y;
      const withinRadius = Math.sqrt(dx * dx + dy * dy) <= RAGE_CLICK_RADIUS_PX;
      return sameElement || withinRadius;
    });

    if (nearby.length >= this.rageClickThreshold) {
      const selector = this.buildSelector(target);
      this.bus.emit('awareness:rage-click', {
        selector,
        clicks: nearby.length,
      });
      this.log(`Rage click detected (${nearby.length} clicks) on "${selector}"`);

      // Clear clicks so we don't keep re-emitting for the same burst.
      this.recentClicks.length = 0;
    }
  };

  // -----------------------------------------------------------------------
  // Generic interaction handler (touch, keydown)
  // -----------------------------------------------------------------------

  private readonly handleInteraction = (): void => {
    this.recordInteraction();
  };

  // -----------------------------------------------------------------------
  // Interaction bookkeeping (shared by all handlers)
  // -----------------------------------------------------------------------

  private recordInteraction(): void {
    this.lastInteractionAt = Date.now();

    // If user was idle, mark active again and reset idle timer.
    if (this.isIdle) {
      this.isIdle = false;
      this.log('User returned from idle');
    }

    this.scheduleIdleTimer();
  }

  // -----------------------------------------------------------------------
  // Idle detection
  // -----------------------------------------------------------------------

  private scheduleIdleTimer(): void {
    this.clearIdleTimer();

    this.idleTimer = setTimeout(() => {
      if (!this.running) return;

      this.isIdle = true;
      const durationMs = Date.now() - this.lastInteractionAt;

      this.bus.emit('awareness:idle', { durationMs });
      this.log(`User idle for ${durationMs}ms`);
    }, this.idleTimeoutMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Dwell detection
  // -----------------------------------------------------------------------

  /**
   * Periodically (every 1s) check whether the user has been focused on the
   * same section long enough to trigger a dwell event.
   */
  private readonly checkDwell = (): void => {
    if (!this.running) return;

    // Determine the section with the highest visibility ratio.
    let bestId: string | null = null;
    let bestRatio = 0;

    for (const [id, ratio] of this.visibleSections) {
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestId = id;
      }
    }

    // If the focused section changed, reset the dwell tracker.
    if (bestId !== this.focusedSectionId) {
      this.focusedSectionId = bestId;
      this.focusedSectionSince = Date.now();
      this.dwellEmitted = false;
      return;
    }

    // If we have a focused section and haven't emitted yet, check duration.
    if (this.focusedSectionId !== null && !this.dwellEmitted) {
      const dwellMs = Date.now() - this.focusedSectionSince;
      if (dwellMs >= this.dwellTimeoutMs) {
        this.dwellEmitted = true;
        this.bus.emit('awareness:dwell', {
          sectionId: this.focusedSectionId,
          durationMs: dwellMs,
        });
        this.log(`Dwell on "${this.focusedSectionId}" (${dwellMs}ms)`);
      }
    }
  };

  private clearDwellTimer(): void {
    if (this.dwellTimer !== null) {
      clearInterval(this.dwellTimer);
      this.dwellTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // IntersectionObserver — section visibility
  // -----------------------------------------------------------------------

  private initSectionObserver(): void {
    if (typeof IntersectionObserver === 'undefined') {
      this.log('IntersectionObserver not available — section tracking disabled');
      return;
    }

    this.sectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const sectionId = this.getSectionId(entry.target);
          if (!sectionId) continue;

          const ratio = Math.round(entry.intersectionRatio * 100) / 100;
          const previous = this.visibleSections.get(sectionId);

          if (previous === ratio) continue;

          if (ratio === 0) {
            this.visibleSections.delete(sectionId);
          } else {
            this.visibleSections.set(sectionId, ratio);
          }

          this.bus.emit('awareness:section-visible', {
            sectionId,
            ratio,
          });
        }
      },
      {
        root: this.rootElement ?? null,
        threshold: IO_THRESHOLDS,
      },
    );

    this.observeSections();
  }

  /**
   * Query the DOM for observable sections and start observing them.
   */
  private observeSections(): void {
    if (!this.sectionObserver) return;

    const root = this.rootElement ?? document;
    const elements = root.querySelectorAll(SECTION_SELECTOR);

    if (elements.length === 0) {
      this.log('No observable sections found');
      return;
    }

    for (const el of elements) {
      this.sectionObserver.observe(el);
    }

    this.log(`Observing ${elements.length} section(s)`);
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Derive a stable string identifier for a DOM element used as a section.
   *
   * Priority: `data-guidekit-target` > `id` > tagName.
   */
  private getSectionId(el: Element): string | null {
    const guidekitTarget = el.getAttribute('data-guidekit-target');
    if (guidekitTarget) return guidekitTarget;

    const id = el.getAttribute('id');
    if (id) return `#${id}`;

    // For semantic landmarks, use the tag name (lowercase).
    const tag = el.tagName.toLowerCase();
    const landmarks = ['main', 'section', 'article', 'aside', 'nav', 'header', 'footer'];
    if (landmarks.includes(tag)) return tag;

    return null;
  }

  /**
   * Build a simple CSS selector string for an element, suitable for
   * inclusion in rage-click events.
   */
  private buildSelector(el: Element): string {
    // Prefer id.
    if (el.id) return `#${el.id}`;

    // data-guidekit-target
    const target = el.getAttribute('data-guidekit-target');
    if (target) return `[data-guidekit-target="${target}"]`;

    // Construct a tag.class selector.
    const tag = el.tagName.toLowerCase();
    const classes = Array.from(el.classList)
      .slice(0, 3) // Limit to avoid absurdly long selectors
      .map((c) => `.${c}`)
      .join('');

    return `${tag}${classes}`;
  }

  /** Conditional debug logging. */
  private log(...args: unknown[]): void {
    if (this.debugEnabled) {
      console.debug(LOG_PREFIX, ...args);
    }
  }
}
