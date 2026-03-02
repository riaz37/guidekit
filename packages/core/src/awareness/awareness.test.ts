// ---------------------------------------------------------------------------
// Tests for AwarenessSystem
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AwarenessSystem } from './index.js';
import { EventBus } from '../bus/index.js';

// ---------------------------------------------------------------------------
// Helpers & mocks
// ---------------------------------------------------------------------------

let ioCallback: IntersectionObserverCallback;
const mockIO = {
  observe: vi.fn(),
  disconnect: vi.fn(),
  unobserve: vi.fn(),
};

vi.stubGlobal(
  'IntersectionObserver',
  vi.fn((cb: IntersectionObserverCallback) => {
    ioCallback = cb;
    return mockIO;
  }),
);

vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  cb(0);
  return 0;
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

/** Mutable scrollY value accessible via getter on window. */
let _scrollY = 0;

function setScrollY(value: number): void {
  _scrollY = value;
  Object.defineProperty(window, 'scrollY', {
    get: () => _scrollY,
    configurable: true,
  });
}

describe('AwarenessSystem', () => {
  let bus: EventBus;
  let awareness: AwarenessSystem;

  beforeEach(() => {
    vi.useFakeTimers();
    // Re-stub rAF after useFakeTimers (which overrides it)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });

    bus = new EventBus();
    awareness = new AwarenessSystem({ bus });

    // Reset mocks
    mockIO.observe.mockClear();
    mockIO.disconnect.mockClear();
    mockIO.unobserve.mockClear();
    (IntersectionObserver as unknown as ReturnType<typeof vi.fn>).mockClear();

    // Default scroll environment
    setScrollY(0);
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 2000,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      configurable: true,
    });
  });

  afterEach(() => {
    awareness.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('creates an instance without throwing', () => {
      expect(awareness).toBeInstanceOf(AwarenessSystem);
    });

    it('does not start observing on construction', () => {
      expect(mockIO.observe).not.toHaveBeenCalled();
    });

    it('accepts optional configuration', () => {
      const custom = new AwarenessSystem({
        bus,
        idleTimeoutMs: 30_000,
        dwellTimeoutMs: 5_000,
        rageClickThreshold: 5,
        rageClickWindowMs: 3_000,
        debug: true,
      });
      expect(custom).toBeInstanceOf(AwarenessSystem);
      custom.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // start()
  // -----------------------------------------------------------------------

  describe('start()', () => {
    it('begins observing after start', () => {
      awareness.start();
      expect(IntersectionObserver).toHaveBeenCalled();
    });

    it('is idempotent — second call is a no-op', () => {
      awareness.start();
      awareness.start();
      expect(IntersectionObserver).toHaveBeenCalledTimes(1);
    });

    it('registers scroll listener', () => {
      const spy = vi.spyOn(window, 'addEventListener');
      awareness.start();
      const scrollCall = spy.mock.calls.find((c) => c[0] === 'scroll');
      expect(scrollCall).toBeDefined();
    });

    it('registers click listener', () => {
      const spy = vi.spyOn(window, 'addEventListener');
      awareness.start();
      const clickCall = spy.mock.calls.find((c) => c[0] === 'click');
      expect(clickCall).toBeDefined();
    });

    it('registers mousemove listener', () => {
      const spy = vi.spyOn(window, 'addEventListener');
      awareness.start();
      const moveCall = spy.mock.calls.find((c) => c[0] === 'mousemove');
      expect(moveCall).toBeDefined();
    });

    it('registers keydown listener', () => {
      const spy = vi.spyOn(window, 'addEventListener');
      awareness.start();
      const keyCall = spy.mock.calls.find((c) => c[0] === 'keydown');
      expect(keyCall).toBeDefined();
    });

    it('registers touchstart and touchend listeners', () => {
      const spy = vi.spyOn(window, 'addEventListener');
      awareness.start();
      const touchStart = spy.mock.calls.find((c) => c[0] === 'touchstart');
      const touchEnd = spy.mock.calls.find((c) => c[0] === 'touchend');
      expect(touchStart).toBeDefined();
      expect(touchEnd).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // stop() / destroy()
  // -----------------------------------------------------------------------

  describe('stop()', () => {
    it('disconnects IntersectionObserver', () => {
      awareness.start();
      awareness.stop();
      expect(mockIO.disconnect).toHaveBeenCalled();
    });

    it('clears visible sections', () => {
      awareness.start();

      // Simulate a section becoming visible
      ioCallback(
        [
          {
            target: createElementWithId('sec1'),
            intersectionRatio: 0.5,
          } as unknown as IntersectionObserverEntry,
        ],
        mockIO as unknown as IntersectionObserver,
      );

      expect(awareness.getState().visibleSections.size).toBe(1);

      awareness.stop();
      expect(awareness.getState().visibleSections.size).toBe(0);
    });

    it('is idempotent — calling stop when not running is safe', () => {
      awareness.stop(); // no prior start
      expect(mockIO.disconnect).not.toHaveBeenCalled();
    });

    it('resets scroll state', () => {
      awareness.start();

      // Simulate scroll
      setScrollY(600);
      window.dispatchEvent(new Event('scroll'));
      expect(awareness.getState().scrollPercent).toBeGreaterThan(0);

      awareness.stop();
      expect(awareness.getState().scrollPercent).toBe(0);
      expect(awareness.getState().scrollDirection).toBe('none');
    });

    it('resets idle state', () => {
      awareness.start();
      vi.advanceTimersByTime(60_000);
      expect(awareness.getState().isIdle).toBe(true);

      awareness.stop();
      expect(awareness.getState().isIdle).toBe(false);
    });
  });

  describe('destroy()', () => {
    it('is an alias for stop()', () => {
      awareness.start();
      awareness.destroy();
      expect(mockIO.disconnect).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // getState()
  // -----------------------------------------------------------------------

  describe('getState()', () => {
    it('returns a state snapshot', () => {
      const state = awareness.getState();
      expect(state).toHaveProperty('scrollPercent');
      expect(state).toHaveProperty('scrollDirection');
      expect(state).toHaveProperty('focusedSectionId');
      expect(state).toHaveProperty('focusedSectionDwellMs');
      expect(state).toHaveProperty('isIdle');
      expect(state).toHaveProperty('lastInteractionAt');
      expect(state).toHaveProperty('visibleSections');
    });

    it('returns defaults before start', () => {
      const state = awareness.getState();
      expect(state.scrollPercent).toBe(0);
      expect(state.scrollDirection).toBe('none');
      expect(state.focusedSectionId).toBeNull();
      expect(state.isIdle).toBe(false);
      expect(state.visibleSections.size).toBe(0);
    });

    it('returns a copy of visibleSections (not the internal map)', () => {
      awareness.start();
      const state1 = awareness.getState();
      const state2 = awareness.getState();
      expect(state1.visibleSections).not.toBe(state2.visibleSections);
    });
  });

  // -----------------------------------------------------------------------
  // Idle detection
  // -----------------------------------------------------------------------

  describe('idle detection', () => {
    it('emits awareness:idle after 60s of no interaction', () => {
      const handler = vi.fn();
      bus.on('awareness:idle', handler);

      awareness.start();
      vi.advanceTimersByTime(60_000);

      expect(handler).toHaveBeenCalledTimes(1);
      const payload = handler.mock.calls[0]![0];
      expect(payload).toHaveProperty('durationMs');
      expect(payload.durationMs).toBeTypeOf('number');
    });

    it('does not emit idle before 60s', () => {
      const handler = vi.fn();
      bus.on('awareness:idle', handler);

      awareness.start();
      vi.advanceTimersByTime(59_999);

      expect(handler).not.toHaveBeenCalled();
    });

    it('sets isIdle in state when idle fires', () => {
      awareness.start();
      vi.advanceTimersByTime(60_000);
      expect(awareness.getState().isIdle).toBe(true);
    });

    it('only emits idle once per idle period', () => {
      const handler = vi.fn();
      bus.on('awareness:idle', handler);

      awareness.start();
      vi.advanceTimersByTime(60_000);
      vi.advanceTimersByTime(60_000);

      // Only 1 emit because after first idle, the timer is not rescheduled
      // until user interaction resets it
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('resets idle after user interaction and can fire again', () => {
      const handler = vi.fn();
      bus.on('awareness:idle', handler);

      awareness.start();
      vi.advanceTimersByTime(60_000); // goes idle
      expect(handler).toHaveBeenCalledTimes(1);

      // User interacts (keydown resets idle)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      expect(awareness.getState().isIdle).toBe(false);

      vi.advanceTimersByTime(60_000); // goes idle again
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('respects custom idle timeout', () => {
      const custom = new AwarenessSystem({ bus, idleTimeoutMs: 10_000 });
      const handler = vi.fn();
      bus.on('awareness:idle', handler);

      custom.start();
      vi.advanceTimersByTime(10_000);
      expect(handler).toHaveBeenCalledTimes(1);
      custom.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // Dwell detection
  // -----------------------------------------------------------------------

  describe('dwell detection', () => {
    function simulateSectionVisible(sectionId: string, ratio: number): void {
      const el = createElementWithId(sectionId);
      ioCallback(
        [
          {
            target: el,
            intersectionRatio: ratio,
          } as unknown as IntersectionObserverEntry,
        ],
        mockIO as unknown as IntersectionObserver,
      );
    }

    it('emits awareness:dwell after 8s of focus on a section', () => {
      const handler = vi.fn();
      bus.on('awareness:dwell', handler);

      awareness.start();
      simulateSectionVisible('sec1', 0.75);

      // Dwell check runs every 1s; at 9s the dwell timer will see >= 8s
      vi.advanceTimersByTime(9_000);

      expect(handler).toHaveBeenCalledTimes(1);
      const payload = handler.mock.calls[0]![0];
      expect(payload.sectionId).toBe('#sec1');
      expect(payload.durationMs).toBeTypeOf('number');
    });

    it('does not emit dwell before 8s', () => {
      const handler = vi.fn();
      bus.on('awareness:dwell', handler);

      awareness.start();
      simulateSectionVisible('sec1', 0.75);

      vi.advanceTimersByTime(7_000);
      expect(handler).not.toHaveBeenCalled();
    });

    it('emits dwell only once per section until section changes', () => {
      const handler = vi.fn();
      bus.on('awareness:dwell', handler);

      awareness.start();
      simulateSectionVisible('sec1', 0.75);

      vi.advanceTimersByTime(20_000);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('resets dwell when focused section changes', () => {
      const handler = vi.fn();
      bus.on('awareness:dwell', handler);

      awareness.start();
      simulateSectionVisible('sec1', 0.75);
      vi.advanceTimersByTime(9_000); // dwell on sec1
      expect(handler).toHaveBeenCalledTimes(1);

      // Switch to sec2
      simulateSectionVisible('sec2', 0.9);
      vi.advanceTimersByTime(9_000); // dwell on sec2
      expect(handler).toHaveBeenCalledTimes(2);
      const lastPayload = handler.mock.calls[handler.mock.calls.length - 1]![0];
      expect(lastPayload.sectionId).toBe('#sec2');
    });

    it('respects custom dwell timeout', () => {
      const custom = new AwarenessSystem({ bus, dwellTimeoutMs: 3_000 });
      const handler = vi.fn();
      bus.on('awareness:dwell', handler);

      custom.start();
      simulateSectionVisible('sec1', 0.75);

      vi.advanceTimersByTime(4_000);
      expect(handler).toHaveBeenCalledTimes(1);
      custom.destroy();
    });

    it('does not emit dwell when no sections are visible', () => {
      const handler = vi.fn();
      bus.on('awareness:dwell', handler);

      awareness.start();
      vi.advanceTimersByTime(20_000);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Rage click detection
  // -----------------------------------------------------------------------

  describe('rage click detection', () => {
    function clickOn(
      target: Element,
      x = 100,
      y = 200,
    ): void {
      const event = new MouseEvent('click', {
        clientX: x,
        clientY: y,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: target });
      window.dispatchEvent(event);
    }

    it('emits awareness:rage-click after 3 clicks on same element within 2s', () => {
      const handler = vi.fn();
      bus.on('awareness:rage-click', handler);

      const button = document.createElement('button');
      button.id = 'test-btn';
      document.body.appendChild(button);

      awareness.start();

      clickOn(button, 100, 200);
      clickOn(button, 100, 200);
      clickOn(button, 100, 200);

      expect(handler).toHaveBeenCalledTimes(1);
      const payload = handler.mock.calls[0]![0];
      expect(payload.selector).toBe('#test-btn');
      expect(payload.clicks).toBe(3);

      document.body.removeChild(button);
    });

    it('emits rage-click for clicks within 50px radius on different elements', () => {
      const handler = vi.fn();
      bus.on('awareness:rage-click', handler);

      const div = document.createElement('div');
      document.body.appendChild(div);

      awareness.start();

      clickOn(div, 100, 200);
      clickOn(div, 110, 210); // within 50px
      clickOn(div, 120, 205); // within 50px

      expect(handler).toHaveBeenCalledTimes(1);

      document.body.removeChild(div);
    });

    it('does not emit rage-click for 2 clicks (below threshold)', () => {
      const handler = vi.fn();
      bus.on('awareness:rage-click', handler);

      const button = document.createElement('button');
      document.body.appendChild(button);

      awareness.start();

      clickOn(button, 100, 200);
      clickOn(button, 100, 200);

      expect(handler).not.toHaveBeenCalled();

      document.body.removeChild(button);
    });

    it('does not emit rage-click when clicks are outside 2s window', () => {
      const handler = vi.fn();
      bus.on('awareness:rage-click', handler);

      const button = document.createElement('button');
      document.body.appendChild(button);

      awareness.start();

      clickOn(button, 100, 200);
      vi.advanceTimersByTime(1_500);
      clickOn(button, 100, 200);
      vi.advanceTimersByTime(1_500);
      clickOn(button, 100, 200);

      // The first click is > 2s before the last, so pruned
      expect(handler).not.toHaveBeenCalled();

      document.body.removeChild(button);
    });

    it('clears click buffer after rage-click to prevent re-emit', () => {
      const handler = vi.fn();
      bus.on('awareness:rage-click', handler);

      const button = document.createElement('button');
      button.id = 'rage-btn';
      document.body.appendChild(button);

      awareness.start();

      clickOn(button, 100, 200);
      clickOn(button, 100, 200);
      clickOn(button, 100, 200); // triggers
      clickOn(button, 100, 200); // should not re-trigger immediately

      expect(handler).toHaveBeenCalledTimes(1);

      document.body.removeChild(button);
    });

    it('includes CSS selector in rage-click event', () => {
      const handler = vi.fn();
      bus.on('awareness:rage-click', handler);

      const button = document.createElement('button');
      button.classList.add('primary');
      document.body.appendChild(button);

      awareness.start();

      clickOn(button, 100, 200);
      clickOn(button, 100, 200);
      clickOn(button, 100, 200);

      const payload = handler.mock.calls[0]![0];
      expect(payload.selector).toBe('button.primary');

      document.body.removeChild(button);
    });

    it('uses data-guidekit-target for selector when available', () => {
      const handler = vi.fn();
      bus.on('awareness:rage-click', handler);

      const button = document.createElement('button');
      button.setAttribute('data-guidekit-target', 'cta-button');
      document.body.appendChild(button);

      awareness.start();

      clickOn(button, 100, 200);
      clickOn(button, 100, 200);
      clickOn(button, 100, 200);

      const payload = handler.mock.calls[0]![0];
      expect(payload.selector).toBe('[data-guidekit-target="cta-button"]');

      document.body.removeChild(button);
    });

    it('respects custom rage-click threshold', () => {
      const custom = new AwarenessSystem({
        bus,
        rageClickThreshold: 5,
      });
      const handler = vi.fn();
      bus.on('awareness:rage-click', handler);

      const button = document.createElement('button');
      document.body.appendChild(button);

      custom.start();

      clickOn(button, 100, 200);
      clickOn(button, 100, 200);
      clickOn(button, 100, 200);

      expect(handler).not.toHaveBeenCalled();

      clickOn(button, 100, 200);
      clickOn(button, 100, 200);
      expect(handler).toHaveBeenCalledTimes(1);

      custom.destroy();
      document.body.removeChild(button);
    });
  });

  // -----------------------------------------------------------------------
  // Section visibility (IntersectionObserver)
  // -----------------------------------------------------------------------

  describe('section visibility', () => {
    it('emits awareness:section-visible when IO callback fires', () => {
      const handler = vi.fn();
      bus.on('awareness:section-visible', handler);

      awareness.start();

      const el = createElementWithId('my-section');
      ioCallback(
        [
          {
            target: el,
            intersectionRatio: 0.5,
          } as unknown as IntersectionObserverEntry,
        ],
        mockIO as unknown as IntersectionObserver,
      );

      const payload = handler.mock.calls[0]![0];
      expect(payload).toEqual({ sectionId: '#my-section', ratio: 0.5 });
    });

    it('tracks visibility in state', () => {
      awareness.start();

      const el = createElementWithId('vis-sec');
      ioCallback(
        [
          {
            target: el,
            intersectionRatio: 0.75,
          } as unknown as IntersectionObserverEntry,
        ],
        mockIO as unknown as IntersectionObserver,
      );

      const state = awareness.getState();
      expect(state.visibleSections.get('#vis-sec')).toBe(0.75);
    });

    it('removes section from visible when ratio is 0', () => {
      awareness.start();

      const el = createElementWithId('gone-sec');
      ioCallback(
        [
          {
            target: el,
            intersectionRatio: 0.5,
          } as unknown as IntersectionObserverEntry,
        ],
        mockIO as unknown as IntersectionObserver,
      );
      expect(awareness.getState().visibleSections.has('#gone-sec')).toBe(true);

      ioCallback(
        [
          {
            target: el,
            intersectionRatio: 0,
          } as unknown as IntersectionObserverEntry,
        ],
        mockIO as unknown as IntersectionObserver,
      );
      expect(awareness.getState().visibleSections.has('#gone-sec')).toBe(false);
    });

    it('uses data-guidekit-target for section ID when present', () => {
      const handler = vi.fn();
      bus.on('awareness:section-visible', handler);

      awareness.start();

      const el = document.createElement('div');
      el.setAttribute('data-guidekit-target', 'hero');
      ioCallback(
        [
          {
            target: el,
            intersectionRatio: 0.25,
          } as unknown as IntersectionObserverEntry,
        ],
        mockIO as unknown as IntersectionObserver,
      );

      const payload = handler.mock.calls[0]![0];
      expect(payload).toEqual({ sectionId: 'hero', ratio: 0.25 });
    });

    it('uses tagName for semantic landmark elements', () => {
      const handler = vi.fn();
      bus.on('awareness:section-visible', handler);

      awareness.start();

      const el = document.createElement('main');
      ioCallback(
        [
          {
            target: el,
            intersectionRatio: 1.0,
          } as unknown as IntersectionObserverEntry,
        ],
        mockIO as unknown as IntersectionObserver,
      );

      const payload = handler.mock.calls[0]![0];
      expect(payload).toEqual({ sectionId: 'main', ratio: 1.0 });
    });

    it('does not emit when ratio is unchanged', () => {
      const handler = vi.fn();
      bus.on('awareness:section-visible', handler);

      awareness.start();

      const el = createElementWithId('dup-sec');
      const entry = {
        target: el,
        intersectionRatio: 0.5,
      } as unknown as IntersectionObserverEntry;

      ioCallback([entry], mockIO as unknown as IntersectionObserver);
      ioCallback([entry], mockIO as unknown as IntersectionObserver);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('observes sections matching SECTION_SELECTOR', () => {
      const sec = document.createElement('section');
      sec.id = 'observed';
      document.body.appendChild(sec);

      awareness.start();

      // The observer should have been told to observe the section
      expect(mockIO.observe).toHaveBeenCalled();

      document.body.removeChild(sec);
    });
  });

  // -----------------------------------------------------------------------
  // Scroll tracking
  // -----------------------------------------------------------------------

  describe('scroll tracking', () => {
    it('updates scroll percentage on scroll', () => {
      awareness.start();

      setScrollY(600);
      window.dispatchEvent(new Event('scroll'));

      const state = awareness.getState();
      // scrollPercent = 600 / (2000 - 800) = 0.5
      expect(state.scrollPercent).toBeCloseTo(0.5, 1);
    });

    it('tracks scroll direction as down', () => {
      awareness.start();

      setScrollY(200);
      window.dispatchEvent(new Event('scroll'));

      expect(awareness.getState().scrollDirection).toBe('down');
    });

    it('tracks scroll direction as up', () => {
      awareness.start();

      // First scroll down
      setScrollY(500);
      window.dispatchEvent(new Event('scroll'));

      // Then scroll up
      setScrollY(200);
      window.dispatchEvent(new Event('scroll'));

      expect(awareness.getState().scrollDirection).toBe('up');
    });

    it('clamps scroll percentage to 1', () => {
      awareness.start();

      setScrollY(5000); // way past the bottom
      window.dispatchEvent(new Event('scroll'));

      expect(awareness.getState().scrollPercent).toBe(1);
    });

    it('handles zero max scroll (page fits in viewport)', () => {
      Object.defineProperty(document.documentElement, 'scrollHeight', {
        value: 800,
        configurable: true,
      });

      awareness.start();

      setScrollY(0);
      window.dispatchEvent(new Event('scroll'));

      expect(awareness.getState().scrollPercent).toBe(0);
    });

    it('scroll resets idle timer', () => {
      const handler = vi.fn();
      bus.on('awareness:idle', handler);

      awareness.start();

      vi.advanceTimersByTime(50_000);
      window.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(50_000);

      // Should not have gone idle because scroll reset the timer
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // SSR safety
  // -----------------------------------------------------------------------

  describe('SSR safety', () => {
    it('start() is a no-op when window is undefined', () => {
      const originalWindow = globalThis.window;
      // @ts-expect-error -- intentionally removing window for SSR test
      delete globalThis.window;

      const ssrAwareness = new AwarenessSystem({ bus });
      ssrAwareness.start();

      // No IO should have been created
      expect(IntersectionObserver).not.toHaveBeenCalled();

      // Restore
      globalThis.window = originalWindow;
    });
  });

  // -----------------------------------------------------------------------
  // Interaction resets
  // -----------------------------------------------------------------------

  describe('interaction resets', () => {
    it('keydown resets idle timer', () => {
      const handler = vi.fn();
      bus.on('awareness:idle', handler);

      awareness.start();
      vi.advanceTimersByTime(50_000);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      vi.advanceTimersByTime(50_000);

      expect(handler).not.toHaveBeenCalled();
    });

    it('mousemove resets idle (throttled at 200ms)', () => {
      const handler = vi.fn();
      bus.on('awareness:idle', handler);

      awareness.start();
      vi.advanceTimersByTime(50_000);

      // First mouse move should reset
      window.dispatchEvent(new MouseEvent('mousemove'));
      vi.advanceTimersByTime(50_000);

      expect(handler).not.toHaveBeenCalled();
    });

    it('mousemove is throttled — fast moves do not all reset', () => {
      awareness.start();

      // Record the last interaction at a known time
      const stateBefore = awareness.getState();
      const _tsA = stateBefore.lastInteractionAt;

      // Immediately move mouse — should be throttled (within 200ms of start)
      vi.advanceTimersByTime(50);
      window.dispatchEvent(new MouseEvent('mousemove'));

      // The lastInteractionAt should not have changed (throttled)
      // Actually it depends on the delta from the last mousemove timestamp
      // The first mousemove after start will go through because lastMouseMoveAt starts at 0
      // Subsequent moves within 200ms should be throttled
      window.dispatchEvent(new MouseEvent('mousemove'));
      const ts1 = awareness.getState().lastInteractionAt;

      vi.advanceTimersByTime(50);
      window.dispatchEvent(new MouseEvent('mousemove'));
      const ts2 = awareness.getState().lastInteractionAt;

      // ts2 should equal ts1 because the second move was within 200ms
      expect(ts2).toBe(ts1);
    });

    it('click resets idle timer', () => {
      const handler = vi.fn();
      bus.on('awareness:idle', handler);

      awareness.start();
      vi.advanceTimersByTime(50_000);

      const button = document.createElement('button');
      document.body.appendChild(button);
      const event = new MouseEvent('click', {
        clientX: 50,
        clientY: 50,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: button });
      window.dispatchEvent(event);

      vi.advanceTimersByTime(50_000);
      expect(handler).not.toHaveBeenCalled();

      document.body.removeChild(button);
    });
  });

  // -----------------------------------------------------------------------
  // Multiple sections
  // -----------------------------------------------------------------------

  describe('focused section tracking', () => {
    it('identifies the section with highest visibility as focused', () => {
      awareness.start();

      const el1 = createElementWithId('sec-a');
      const el2 = createElementWithId('sec-b');

      ioCallback(
        [
          { target: el1, intersectionRatio: 0.25 } as unknown as IntersectionObserverEntry,
          { target: el2, intersectionRatio: 0.75 } as unknown as IntersectionObserverEntry,
        ],
        mockIO as unknown as IntersectionObserver,
      );

      // After dwell check runs
      vi.advanceTimersByTime(1_000);

      const state = awareness.getState();
      expect(state.focusedSectionId).toBe('#sec-b');
    });

    it('focusedSectionDwellMs increases over time', () => {
      awareness.start();

      const el = createElementWithId('dwell-check');
      ioCallback(
        [
          { target: el, intersectionRatio: 0.5 } as unknown as IntersectionObserverEntry,
        ],
        mockIO as unknown as IntersectionObserver,
      );

      vi.advanceTimersByTime(1_000); // dwell check runs, sets focused
      vi.advanceTimersByTime(3_000);

      const state = awareness.getState();
      expect(state.focusedSectionDwellMs).toBeGreaterThanOrEqual(3_000);
    });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createElementWithId(id: string): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  return el;
}
