// ---------------------------------------------------------------------------
// Tests for ProactiveTriggerEngine
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProactiveTriggerEngine, ProactiveTrigger } from './proactive.js';
import { EventBus } from '../bus/index.js';

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

let store: Record<string, string> = {};

vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, val: string) => {
    store[key] = val;
  }),
  removeItem: vi.fn((key: string) => {
    delete store[key];
  }),
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ProactiveTriggerEngine', () => {
  let bus: EventBus;
  let triggers: ProactiveTrigger[];
  let engine: ProactiveTriggerEngine;

  function onTrigger(t: ProactiveTrigger): void {
    triggers.push(t);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    store = {};
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockClear();
    (localStorage.setItem as ReturnType<typeof vi.fn>).mockClear();

    bus = new EventBus();
    triggers = [];
    engine = new ProactiveTriggerEngine({ bus, onTrigger });
  });

  afterEach(() => {
    engine.destroy();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Constructor & lifecycle
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('creates an instance without auto-starting', () => {
      expect(engine).toBeInstanceOf(ProactiveTriggerEngine);
      // No greeting fired yet since start() not called
      expect(triggers).toHaveLength(0);
    });
  });

  describe('start()', () => {
    it('subscribes to bus events', () => {
      engine.start();
      // After start, the engine should be listening to awareness events
      // We can verify by emitting events and checking triggers
      bus.emit('awareness:idle', { durationMs: 60_000 });
      expect(triggers.some((t) => t.type === 'idle-help')).toBe(true);
    });

    it('is idempotent — second start is no-op', () => {
      engine.start();
      engine.start();
      // Should only fire greeting once (from the first start)
      const greetings = triggers.filter((t) => t.type === 'greeting');
      expect(greetings.length).toBeLessThanOrEqual(1);
    });
  });

  describe('stop()', () => {
    it('unsubscribes all bus listeners', () => {
      engine.start();
      engine.stop();

      triggers.length = 0;
      bus.emit('awareness:idle', { durationMs: 60_000 });
      expect(triggers).toHaveLength(0);
    });

    it('clears form abandonment timers', () => {
      engine.start();
      engine.onFormInteractionStart('#contact-form');
      engine.stop();

      vi.advanceTimersByTime(20_000);
      expect(triggers.some((t) => t.type === 'form-abandonment')).toBe(false);
    });
  });

  describe('destroy()', () => {
    it('is an alias for stop()', () => {
      engine.start();
      engine.destroy();

      triggers.length = 0;
      bus.emit('awareness:idle', { durationMs: 60_000 });
      expect(triggers).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // First-visit greeting
  // -----------------------------------------------------------------------

  describe('first-visit greeting', () => {
    it('fires greeting trigger when no guidekit:visited key exists', () => {
      engine.start();
      const greetings = triggers.filter((t) => t.type === 'greeting');
      expect(greetings).toHaveLength(1);
    });

    it('sets guidekit:visited in localStorage after greeting', () => {
      engine.start();
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'guidekit:visited',
        expect.any(String),
      );
    });

    it('does not fire greeting when guidekit:visited exists within 7 days', () => {
      store['guidekit:visited'] = Date.now().toString();
      engine.start();

      const greetings = triggers.filter((t) => t.type === 'greeting');
      expect(greetings).toHaveLength(0);
    });

    it('does not fire greeting for return visitor within 7 days', () => {
      // Visited 3 days ago
      const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
      store['guidekit:visited'] = threeDaysAgo.toString();
      engine.start();

      const greetings = triggers.filter((t) => t.type === 'greeting');
      expect(greetings).toHaveLength(0);
    });

    it('does not fire greeting for return visitor after 7 days (no re-greet)', () => {
      // Visited 10 days ago
      const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
      store['guidekit:visited'] = tenDaysAgo.toString();
      engine.start();

      // The code only fires greeting on first visit (null check)
      const greetings = triggers.filter((t) => t.type === 'greeting');
      expect(greetings).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Idle help
  // -----------------------------------------------------------------------

  describe('idle-help', () => {
    it('fires idle-help on awareness:idle with durationMs >= 60000', () => {
      engine.start();
      triggers.length = 0;

      bus.emit('awareness:idle', { durationMs: 60_000 });

      expect(triggers).toHaveLength(1);
      expect(triggers[0]!.type).toBe('idle-help');
    });

    it('does not fire idle-help when durationMs < 60000', () => {
      engine.start();
      triggers.length = 0;

      bus.emit('awareness:idle', { durationMs: 30_000 });

      expect(triggers.some((t) => t.type === 'idle-help')).toBe(false);
    });

    it('fires idle-help only once per page', () => {
      engine.start();
      triggers.length = 0;

      bus.emit('awareness:idle', { durationMs: 60_000 });
      bus.emit('awareness:idle', { durationMs: 120_000 });

      const idleHelps = triggers.filter((t) => t.type === 'idle-help');
      expect(idleHelps).toHaveLength(1);
    });

    it('resets idleFiredThisPage on route change', () => {
      engine.start();
      triggers.length = 0;

      bus.emit('awareness:idle', { durationMs: 60_000 });
      expect(triggers.filter((t) => t.type === 'idle-help')).toHaveLength(1);

      bus.emit('dom:route-change', { from: '/a', to: '/b' });
      triggers.length = 0;

      bus.emit('awareness:idle', { durationMs: 60_000 });
      expect(triggers.filter((t) => t.type === 'idle-help')).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Dwell commentary
  // -----------------------------------------------------------------------

  describe('dwell commentary', () => {
    it('fires dwell-commentary on awareness:dwell with durationMs >= 8000', () => {
      engine.start();
      triggers.length = 0;

      bus.emit('awareness:dwell', { sectionId: 'pricing', durationMs: 10_000 });

      expect(triggers).toHaveLength(1);
      expect(triggers[0]!.type).toBe('dwell-commentary');
      expect(triggers[0]!.sectionId).toBe('pricing');
    });

    it('does not fire dwell-commentary when durationMs < 8000', () => {
      engine.start();
      triggers.length = 0;

      bus.emit('awareness:dwell', { sectionId: 'pricing', durationMs: 5_000 });

      expect(triggers.some((t) => t.type === 'dwell-commentary')).toBe(false);
    });

    it('applies progressive cooldown: 30s for second trigger', () => {
      engine.start();
      triggers.length = 0;

      // First dwell fires immediately
      bus.emit('awareness:dwell', { sectionId: 'sec', durationMs: 10_000 });
      expect(triggers.filter((t) => t.type === 'dwell-commentary')).toHaveLength(1);

      // Second dwell within 30s cooldown — suppressed
      vi.advanceTimersByTime(20_000);
      bus.emit('awareness:dwell', { sectionId: 'sec', durationMs: 10_000 });
      expect(triggers.filter((t) => t.type === 'dwell-commentary')).toHaveLength(1);

      // After 30s cooldown passes, second fires
      vi.advanceTimersByTime(11_000); // total 31s
      bus.emit('awareness:dwell', { sectionId: 'sec', durationMs: 10_000 });
      expect(triggers.filter((t) => t.type === 'dwell-commentary')).toHaveLength(2);
    });

    it('applies progressive cooldown: 60s for third trigger', () => {
      engine.start();
      triggers.length = 0;

      // First
      bus.emit('awareness:dwell', { sectionId: 'sec', durationMs: 10_000 });

      // Wait 30s, second
      vi.advanceTimersByTime(31_000);
      bus.emit('awareness:dwell', { sectionId: 'sec', durationMs: 10_000 });

      // Wait 60s, third
      vi.advanceTimersByTime(61_000);
      bus.emit('awareness:dwell', { sectionId: 'sec', durationMs: 10_000 });

      expect(triggers.filter((t) => t.type === 'dwell-commentary')).toHaveLength(3);
    });

    it('stops after 4 dwell triggers for the same section', () => {
      engine.start();
      triggers.length = 0;

      // Fire 4 dwells with enough time between each
      bus.emit('awareness:dwell', { sectionId: 'sec', durationMs: 10_000 });
      vi.advanceTimersByTime(31_000);
      bus.emit('awareness:dwell', { sectionId: 'sec', durationMs: 10_000 });
      vi.advanceTimersByTime(61_000);
      bus.emit('awareness:dwell', { sectionId: 'sec', durationMs: 10_000 });
      vi.advanceTimersByTime(121_000);
      bus.emit('awareness:dwell', { sectionId: 'sec', durationMs: 10_000 });

      const dwells = triggers.filter((t) => t.type === 'dwell-commentary');
      expect(dwells).toHaveLength(4);

      // 5th attempt — suppressed
      vi.advanceTimersByTime(200_000);
      bus.emit('awareness:dwell', { sectionId: 'sec', durationMs: 10_000 });
      expect(triggers.filter((t) => t.type === 'dwell-commentary')).toHaveLength(4);
    });

    it('tracks dwell counts separately per section', () => {
      engine.start();
      triggers.length = 0;

      bus.emit('awareness:dwell', { sectionId: 'a', durationMs: 10_000 });
      bus.emit('awareness:dwell', { sectionId: 'b', durationMs: 10_000 });

      const dwells = triggers.filter((t) => t.type === 'dwell-commentary');
      expect(dwells).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Navigation commentary
  // -----------------------------------------------------------------------

  describe('navigation commentary', () => {
    it('fires navigation-commentary on dom:route-change', () => {
      engine.start();
      triggers.length = 0;

      bus.emit('dom:route-change', { from: '/home', to: '/about' });

      expect(triggers.some((t) => t.type === 'navigation-commentary')).toBe(true);
    });

    it('has a 30s cooldown between navigation triggers', () => {
      engine.start();
      triggers.length = 0;

      bus.emit('dom:route-change', { from: '/a', to: '/b' });
      bus.emit('dom:route-change', { from: '/b', to: '/c' }); // within 30s

      const navs = triggers.filter((t) => t.type === 'navigation-commentary');
      expect(navs).toHaveLength(1);
    });

    it('allows navigation trigger after 30s cooldown', () => {
      engine.start();
      triggers.length = 0;

      bus.emit('dom:route-change', { from: '/a', to: '/b' });
      vi.advanceTimersByTime(31_000);
      bus.emit('dom:route-change', { from: '/b', to: '/c' });

      const navs = triggers.filter((t) => t.type === 'navigation-commentary');
      expect(navs).toHaveLength(2);
    });

    it('resets idleFiredThisPage on navigation', () => {
      engine.start();
      triggers.length = 0;

      bus.emit('awareness:idle', { durationMs: 60_000 });
      bus.emit('dom:route-change', { from: '/a', to: '/b' });
      triggers.length = 0;

      bus.emit('awareness:idle', { durationMs: 60_000 });
      expect(triggers.some((t) => t.type === 'idle-help')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Frustration (rage click)
  // -----------------------------------------------------------------------

  describe('frustration', () => {
    it('fires frustration trigger on awareness:rage-click', () => {
      engine.start();
      triggers.length = 0;

      bus.emit('awareness:rage-click', { selector: '#submit-btn', clicks: 4 });

      expect(triggers).toHaveLength(1);
      expect(triggers[0]!.type).toBe('frustration');
      expect(triggers[0]!.selector).toBe('#submit-btn');
    });

    it('fires frustration only once per selector', () => {
      engine.start();
      triggers.length = 0;

      bus.emit('awareness:rage-click', { selector: '#btn', clicks: 3 });
      bus.emit('awareness:rage-click', { selector: '#btn', clicks: 5 });

      const frusts = triggers.filter((t) => t.type === 'frustration');
      expect(frusts).toHaveLength(1);
    });

    it('fires frustration for different selectors', () => {
      engine.start();
      triggers.length = 0;

      bus.emit('awareness:rage-click', { selector: '#btn1', clicks: 3 });
      bus.emit('awareness:rage-click', { selector: '#btn2', clicks: 3 });

      const frusts = triggers.filter((t) => t.type === 'frustration');
      expect(frusts).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Form abandonment
  // -----------------------------------------------------------------------

  describe('form abandonment', () => {
    it('fires form-abandonment after 15s of no interaction', () => {
      engine.start();
      triggers.length = 0;

      engine.onFormInteractionStart('#contact');

      vi.advanceTimersByTime(15_000);

      expect(triggers).toHaveLength(1);
      expect(triggers[0]!.type).toBe('form-abandonment');
      expect(triggers[0]!.selector).toBe('#contact');
    });

    it('does not fire form-abandonment before 15s', () => {
      engine.start();
      triggers.length = 0;

      engine.onFormInteractionStart('#contact');

      vi.advanceTimersByTime(14_000);
      expect(triggers.some((t) => t.type === 'form-abandonment')).toBe(false);
    });

    it('resets timer on subsequent interaction start', () => {
      engine.start();
      triggers.length = 0;

      engine.onFormInteractionStart('#form');
      vi.advanceTimersByTime(10_000);

      // User interacts again — resets the 15s timer
      engine.onFormInteractionStart('#form');
      vi.advanceTimersByTime(10_000);

      // 10s into the second timer — should not have fired
      expect(triggers.some((t) => t.type === 'form-abandonment')).toBe(false);

      vi.advanceTimersByTime(5_000); // total 15s from second start
      expect(triggers.some((t) => t.type === 'form-abandonment')).toBe(true);
    });

    it('tracks multiple forms independently', () => {
      engine.start();
      triggers.length = 0;

      engine.onFormInteractionStart('#form-a');
      engine.onFormInteractionStart('#form-b');

      vi.advanceTimersByTime(15_000);

      const formTriggers = triggers.filter((t) => t.type === 'form-abandonment');
      expect(formTriggers).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Quiet mode
  // -----------------------------------------------------------------------

  describe('quiet mode', () => {
    it('suppresses all triggers when quiet mode is enabled', () => {
      engine.quietMode = true;
      engine.start();

      // Greeting should be suppressed
      const greetings = triggers.filter((t) => t.type === 'greeting');
      expect(greetings).toHaveLength(0);

      triggers.length = 0;
      bus.emit('awareness:idle', { durationMs: 60_000 });
      expect(triggers).toHaveLength(0);
    });

    it('allows triggers when quiet mode is disabled', () => {
      engine.quietMode = true;
      engine.start();
      triggers.length = 0;

      engine.quietMode = false;
      bus.emit('awareness:idle', { durationMs: 60_000 });
      expect(triggers.some((t) => t.type === 'idle-help')).toBe(true);
    });

    it('getter returns current quiet mode state', () => {
      expect(engine.quietMode).toBe(false);
      engine.quietMode = true;
      expect(engine.quietMode).toBe(true);
    });

    it('suppresses rage-click triggers in quiet mode', () => {
      engine.start();
      engine.quietMode = true;
      triggers.length = 0;

      bus.emit('awareness:rage-click', { selector: '#btn', clicks: 5 });
      expect(triggers).toHaveLength(0);
    });

    it('suppresses form-abandonment triggers in quiet mode', () => {
      engine.start();
      engine.quietMode = true;
      triggers.length = 0;

      engine.onFormInteractionStart('#form');
      vi.advanceTimersByTime(15_000);

      expect(triggers).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // resetCooldowns()
  // -----------------------------------------------------------------------

  describe('resetCooldowns()', () => {
    it('clears all internal cooldown state', () => {
      engine.start();
      triggers.length = 0;

      // Fire idle, then try again (should be blocked)
      bus.emit('awareness:idle', { durationMs: 60_000 });
      bus.emit('awareness:idle', { durationMs: 60_000 });
      expect(triggers.filter((t) => t.type === 'idle-help')).toHaveLength(1);

      // Reset and try again
      engine.resetCooldowns();
      triggers.length = 0;
      bus.emit('awareness:idle', { durationMs: 60_000 });
      expect(triggers.filter((t) => t.type === 'idle-help')).toHaveLength(1);
    });

    it('clears frustration tracking', () => {
      engine.start();
      triggers.length = 0;

      bus.emit('awareness:rage-click', { selector: '#btn', clicks: 3 });
      expect(triggers.filter((t) => t.type === 'frustration')).toHaveLength(1);

      engine.resetCooldowns();
      triggers.length = 0;

      bus.emit('awareness:rage-click', { selector: '#btn', clicks: 3 });
      expect(triggers.filter((t) => t.type === 'frustration')).toHaveLength(1);
    });

    it('clears dwell counts', () => {
      engine.start();
      triggers.length = 0;

      bus.emit('awareness:dwell', { sectionId: 'sec', durationMs: 10_000 });
      expect(triggers.filter((t) => t.type === 'dwell-commentary')).toHaveLength(1);

      engine.resetCooldowns();
      triggers.length = 0;

      bus.emit('awareness:dwell', { sectionId: 'sec', durationMs: 10_000 });
      expect(triggers.filter((t) => t.type === 'dwell-commentary')).toHaveLength(1);
    });

    it('clears pending form timers', () => {
      engine.start();
      triggers.length = 0;

      engine.onFormInteractionStart('#form');
      engine.resetCooldowns();

      vi.advanceTimersByTime(20_000);
      expect(triggers.some((t) => t.type === 'form-abandonment')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // onRouteChange (external API)
  // -----------------------------------------------------------------------

  describe('onRouteChange()', () => {
    it('fires navigation-commentary via external call', () => {
      engine.start();
      triggers.length = 0;

      engine.onRouteChange('/old', '/new');
      expect(triggers.some((t) => t.type === 'navigation-commentary')).toBe(true);
    });

    it('resets idle tracking via external route change', () => {
      engine.start();
      triggers.length = 0;

      bus.emit('awareness:idle', { durationMs: 60_000 });
      engine.onRouteChange('/a', '/b');
      triggers.length = 0;

      bus.emit('awareness:idle', { durationMs: 60_000 });
      expect(triggers.some((t) => t.type === 'idle-help')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Trigger metadata
  // -----------------------------------------------------------------------

  describe('trigger metadata', () => {
    it('includes timestamp in every trigger', () => {
      engine.start();
      expect(triggers.length).toBeGreaterThan(0);
      for (const t of triggers) {
        expect(t.timestamp).toBeTypeOf('number');
        expect(t.timestamp).toBeGreaterThan(0);
      }
    });

    it('includes message in triggers', () => {
      engine.start();
      triggers.length = 0;

      bus.emit('awareness:idle', { durationMs: 60_000 });
      expect(triggers[0]!.message).toBeDefined();
      expect(triggers[0]!.message!.length).toBeGreaterThan(0);
    });
  });
});
