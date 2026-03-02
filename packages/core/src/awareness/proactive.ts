// ---------------------------------------------------------------------------
// GuideKit SDK – Proactive Trigger Engine
// ---------------------------------------------------------------------------
// Listens to awareness events on the EventBus and decides when to
// proactively engage the user. The engine itself never shows UI or sends
// LLM messages — it communicates via the `onTrigger` callback so the core
// orchestrator can decide what action to take.
// ---------------------------------------------------------------------------

import { EventBus } from '../bus/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[GuideKit:Proactive]';
const STORAGE_KEY = 'guidekit:visited';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Progressive dwell cooldowns in ms: 30s → 60s → 120s → stop. */
const DWELL_COOLDOWNS = [30_000, 60_000, 120_000];
const DWELL_THRESHOLD_MS = 8_000;
const IDLE_THRESHOLD_MS = 60_000;
const NAVIGATION_COOLDOWN_MS = 30_000;
const FORM_ABANDON_MS = 15_000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ProactiveOptions {
  bus: EventBus;
  debug?: boolean;
  /** Callback invoked whenever a proactive trigger fires. */
  onTrigger?: (trigger: ProactiveTrigger) => void;
}

export type ProactiveTriggerType =
  | 'greeting'
  | 'idle-help'
  | 'dwell-commentary'
  | 'navigation-commentary'
  | 'frustration'
  | 'form-abandonment';

export interface ProactiveTrigger {
  type: ProactiveTriggerType;
  sectionId?: string;
  selector?: string;
  /** Suggested context message for the LLM. */
  message?: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// ProactiveTriggerEngine
// ---------------------------------------------------------------------------

export class ProactiveTriggerEngine {
  private readonly bus: EventBus;
  private readonly debug: boolean;
  private readonly onTrigger?: (trigger: ProactiveTrigger) => void;

  /** Collected unsubscribe functions from bus.on(). */
  private unsubs: Array<() => void> = [];

  /** Cooldown map: trigger key → last-fired timestamp. */
  private cooldowns = new Map<string, number>();

  /** Progressive dwell: sectionId → number of times triggered. */
  private dwellCounts = new Map<string, number>();

  /** Track forms the user started interacting with. */
  private formTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Track sections where frustration already fired (once per section). */
  private frustrationFired = new Set<string>();

  /** Track whether idle-help has fired on this page. */
  private idleFiredThisPage = false;

  private _quietMode = false;
  private started = false;

  constructor(options: ProactiveOptions) {
    this.bus = options.bus;
    this.debug = options.debug ?? false;
    this.onTrigger = options.onTrigger;
  }

  // ---- quietMode accessor -------------------------------------------------

  get quietMode(): boolean {
    return this._quietMode;
  }

  set quietMode(value: boolean) {
    this._quietMode = value;
    if (this.debug) {
      console.debug(LOG_PREFIX, `Quiet mode ${value ? 'enabled' : 'disabled'}`);
    }
  }

  // ---- Lifecycle -----------------------------------------------------------

  /** Subscribe to bus events and check for first-visit greeting. */
  start(): void {
    if (this.started) return;
    this.started = true;

    this.checkFirstVisitGreeting();

    // awareness:idle
    this.unsubs.push(
      this.bus.on('awareness:idle', (data) => {
        this.handleIdle(data.durationMs);
      }),
    );

    // awareness:dwell
    this.unsubs.push(
      this.bus.on('awareness:dwell', (data) => {
        this.handleDwell(data.sectionId, data.durationMs);
      }),
    );

    // awareness:rage-click
    this.unsubs.push(
      this.bus.on('awareness:rage-click', (data) => {
        this.handleRageClick(data.selector, data.clicks);
      }),
    );

    // dom:route-change — used for navigation commentary + page reset
    this.unsubs.push(
      this.bus.on('dom:route-change', (data) => {
        this.handleDomRouteChange(data.from, data.to);
      }),
    );

    if (this.debug) {
      console.debug(LOG_PREFIX, 'Started — subscribed to awareness & dom events');
    }
  }

  /** Unsubscribe all bus listeners and clear internal state. */
  stop(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];

    // Clear any pending form-abandonment timers
    for (const timer of this.formTimers.values()) {
      clearTimeout(timer);
    }
    this.formTimers.clear();

    this.started = false;

    if (this.debug) {
      console.debug(LOG_PREFIX, 'Stopped — all listeners removed');
    }
  }

  /** Alias for {@link stop}. */
  destroy(): void {
    this.stop();
  }

  // ---- External notifications ---------------------------------------------

  /**
   * Notify the engine about a route change.
   * Called from the NavigationController or externally.
   */
  onRouteChange(from: string, to: string): void {
    this.handleNavigation(from, to);
  }

  /**
   * Notify the engine that the user started interacting with a form.
   * If the user does not continue within {@link FORM_ABANDON_MS}, a
   * `form-abandonment` trigger fires (once per form).
   */
  onFormInteractionStart(formSelector: string): void {
    // If there is already a timer for this form, reset it
    const existing = this.formTimers.get(formSelector);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.formTimers.delete(formSelector);
      this.fireTrigger({
        type: 'form-abandonment',
        selector: formSelector,
        message: `User started a form (${formSelector}) but stopped interacting for ${FORM_ABANDON_MS / 1000}s. They may need help.`,
      }, `form-abandonment:${formSelector}`);
    }, FORM_ABANDON_MS);

    this.formTimers.set(formSelector, timer);

    if (this.debug) {
      console.debug(LOG_PREFIX, `Form interaction started: ${formSelector}`);
    }
  }

  /** Reset all cooldowns and internal tracking state (useful for testing). */
  resetCooldowns(): void {
    this.cooldowns.clear();
    this.dwellCounts.clear();
    this.frustrationFired.clear();
    this.idleFiredThisPage = false;

    for (const timer of this.formTimers.values()) {
      clearTimeout(timer);
    }
    this.formTimers.clear();

    if (this.debug) {
      console.debug(LOG_PREFIX, 'All cooldowns and state reset');
    }
  }

  // ---- Internal handlers ---------------------------------------------------

  private checkFirstVisitGreeting(): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return;
    }

    try {
      const visited = localStorage.getItem(STORAGE_KEY);

      if (visited === null) {
        // First visit ever — fire greeting
        localStorage.setItem(STORAGE_KEY, Date.now().toString());

        this.fireTrigger({
          type: 'greeting',
          message: 'First-time visitor detected. Show a visual greeting (no audio).',
        }, 'greeting');

        if (this.debug) {
          console.debug(LOG_PREFIX, 'First visit — greeting triggered');
        }
        return;
      }

      // Return visitor — check if within 7 days
      const visitedAt = parseInt(visited, 10);
      if (!Number.isNaN(visitedAt)) {
        const elapsed = Date.now() - visitedAt;
        if (elapsed <= SEVEN_DAYS_MS && this.debug) {
          console.debug(LOG_PREFIX, 'Return visitor within 7 days — silent');
        } else if (this.debug) {
          console.debug(LOG_PREFIX, 'Return visitor after 7 days');
        }
      }
    } catch {
      // localStorage may be unavailable (e.g. iframe sandbox)
      if (this.debug) {
        console.warn(LOG_PREFIX, 'localStorage unavailable — skipping greeting check');
      }
    }
  }

  private handleIdle(durationMs: number): void {
    if (durationMs < IDLE_THRESHOLD_MS) return;
    if (this.idleFiredThisPage) return;

    this.idleFiredThisPage = true;

    this.fireTrigger({
      type: 'idle-help',
      message: `User has been idle for ${Math.round(durationMs / 1000)}s. They may be stuck or unsure what to do next.`,
    }, 'idle-help');
  }

  private handleDwell(sectionId: string, durationMs: number): void {
    if (durationMs < DWELL_THRESHOLD_MS) return;

    const count = this.dwellCounts.get(sectionId) ?? 0;

    // After 4 dwell triggers for the same section, stop entirely
    if (count >= DWELL_COOLDOWNS.length + 1) {
      if (this.debug) {
        console.debug(LOG_PREFIX, `Dwell cap reached for section "${sectionId}" — suppressed`);
      }
      return;
    }

    // Check progressive cooldown
    if (count > 0) {
      const cooldownMs = DWELL_COOLDOWNS[Math.min(count - 1, DWELL_COOLDOWNS.length - 1)]!;
      const key = `dwell:${sectionId}`;
      const lastFired = this.cooldowns.get(key) ?? 0;

      if (Date.now() - lastFired < cooldownMs) {
        if (this.debug) {
          console.debug(LOG_PREFIX, `Dwell cooldown active for "${sectionId}" — suppressed`);
        }
        return;
      }
    }

    this.dwellCounts.set(sectionId, count + 1);

    this.fireTrigger({
      type: 'dwell-commentary',
      sectionId,
      message: `User has been dwelling on section "${sectionId}" for ${Math.round(durationMs / 1000)}s. They may need more context.`,
    }, `dwell:${sectionId}`);
  }

  private handleRageClick(selector: string, clicks: number): void {
    // Derive a "section" key from the selector for once-per-section tracking
    const sectionKey = selector;

    if (this.frustrationFired.has(sectionKey)) {
      if (this.debug) {
        console.debug(LOG_PREFIX, `Frustration already fired for "${selector}" — suppressed`);
      }
      return;
    }

    this.frustrationFired.add(sectionKey);

    this.fireTrigger({
      type: 'frustration',
      selector,
      message: `User rage-clicked (${clicks} clicks) on "${selector}". They seem frustrated — offer help.`,
    }, `frustration:${sectionKey}`);
  }

  private handleNavigation(from: string, to: string): void {
    // Reset per-page cooldowns on page change
    this.idleFiredThisPage = false;

    const key = 'navigation-commentary';
    if (this.isCooldownActive(key, NAVIGATION_COOLDOWN_MS)) {
      if (this.debug) {
        console.debug(LOG_PREFIX, 'Navigation cooldown active — suppressed');
      }
      return;
    }

    this.fireTrigger({
      type: 'navigation-commentary',
      message: `User navigated from "${from}" to "${to}". Offer context about the new page.`,
    }, key);
  }

  /**
   * Handler for the bus `dom:route-change` event.
   * Delegates to the shared navigation logic.
   */
  private handleDomRouteChange(from: string, to: string): void {
    this.handleNavigation(from, to);
  }

  // ---- Trigger dispatch ----------------------------------------------------

  /**
   * Fire a trigger if quiet mode is off, recording the cooldown timestamp.
   */
  private fireTrigger(
    partial: Omit<ProactiveTrigger, 'timestamp'>,
    cooldownKey: string,
  ): void {
    if (this._quietMode) {
      if (this.debug) {
        console.debug(LOG_PREFIX, `Quiet mode — suppressed trigger: ${partial.type}`);
      }
      return;
    }

    const trigger: ProactiveTrigger = {
      ...partial,
      timestamp: Date.now(),
    };

    this.cooldowns.set(cooldownKey, trigger.timestamp);

    if (this.debug) {
      console.debug(LOG_PREFIX, 'Trigger fired:', trigger.type, trigger);
    }

    if (this.onTrigger) {
      try {
        this.onTrigger(trigger);
      } catch (err) {
        console.error(LOG_PREFIX, 'onTrigger callback error:', err);
      }
    }
  }

  // ---- Cooldown helpers ----------------------------------------------------

  private isCooldownActive(key: string, cooldownMs: number): boolean {
    const lastFired = this.cooldowns.get(key);
    if (lastFired === undefined) return false;
    return Date.now() - lastFired < cooldownMs;
  }
}
