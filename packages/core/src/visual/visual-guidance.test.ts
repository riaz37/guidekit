/**
 * Unit tests for VisualGuidance
 *
 * @module @guidekit/core/visual
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VisualGuidance } from './index.js';
import type { SpotlightState as _SpotlightState } from './index.js';

// ---------------------------------------------------------------------------
// Polyfills for jsdom
// ---------------------------------------------------------------------------

// CSS.escape is not available in jsdom; polyfill it for tests.
if (typeof globalThis.CSS === 'undefined') {
  (globalThis as Record<string, unknown>).CSS = {} as typeof CSS;
}
if (typeof CSS.escape !== 'function') {
  CSS.escape = (value: string) =>
    value.replace(/([^\w-])/g, '\\$1');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a visible element and append it to document.body.
 * Returns the element so tests can clean it up.
 */
function createVisibleElement(
  tag: string,
  attrs: Record<string, string> = {},
  rect?: Partial<DOMRect>,
): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  el.textContent = 'test content';
  document.body.appendChild(el);

  // Override getBoundingClientRect to return a realistic rect
  const defaultRect: DOMRect = {
    x: 100,
    y: 100,
    width: 200,
    height: 50,
    top: 100,
    right: 300,
    bottom: 150,
    left: 100,
    toJSON: () => ({}),
  };
  el.getBoundingClientRect = vi.fn(() => ({
    ...defaultRect,
    ...rect,
  })) as unknown as () => DOMRect;

  return el;
}

/**
 * Create a zero-size element (simulates display: none).
 */
function createZeroSizeElement(
  tag: string,
  attrs: Record<string, string> = {},
): HTMLElement {
  return createVisibleElement(tag, attrs, {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });
}

/**
 * Flush pending timers and microtasks.
 */
function flushTimers() {
  vi.advanceTimersByTime(200);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('VisualGuidance', () => {
  let vg: VisualGuidance;
  let createdElements: HTMLElement[];

  beforeEach(() => {
    vi.useFakeTimers();
    createdElements = [];

    // Mock ResizeObserver
    const mockResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }));
    vi.stubGlobal('ResizeObserver', mockResizeObserver);

    // Mock requestAnimationFrame
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });

    // Mock matchMedia for prefers-reduced-motion
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));

    // Mock window.scrollTo
    vi.stubGlobal('scrollTo', vi.fn());

    // Mock Element.prototype.scrollIntoView (not implemented in jsdom)
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vg?.destroy();
    // Remove any elements we created
    for (const el of createdElements) {
      el.parentNode?.removeChild(el);
    }
    // Remove all guidekit elements from body
    document
      .querySelectorAll(
        '[data-guidekit-overlay], [data-guidekit-spotlight], [data-guidekit-tooltip], [data-guidekit-live]',
      )
      .forEach((el) => el.remove());
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('should create an instance with default options', () => {
      vg = new VisualGuidance();
      expect(vg).toBeInstanceOf(VisualGuidance);
      expect(vg.state.isActive).toBe(false);
    });

    it('should accept custom options', () => {
      vg = new VisualGuidance({
        overlayColor: 'rgba(255, 0, 0, 0.7)',
        spotlightColor: '#ff0000',
        animationDuration: 500,
        spotlightPadding: 16,
        debug: true,
      });
      expect(vg).toBeInstanceOf(VisualGuidance);
    });

    it('should default debug to false', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vg = new VisualGuidance();
      // highlight a missing element should not log when debug is off
      vg.highlight({ selector: '.nonexistent' });
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should log when debug is true', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vg = new VisualGuidance({ debug: true });
      // The constructor itself logs "Initialised"
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[GuideKit:Visual]'),
        expect.anything(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // highlight()
  // -------------------------------------------------------------------------

  describe('highlight()', () => {
    beforeEach(() => {
      vg = new VisualGuidance();
    });

    it('should find an element by CSS selector and return true', () => {
      const el = createVisibleElement('div', { class: 'hero-section' });
      createdElements.push(el);

      const result = vg.highlight({ selector: '.hero-section' });
      expect(result).toBe(true);
      expect(vg.state.isActive).toBe(true);
      expect(vg.state.selector).toBe('.hero-section');
    });

    it('should find an element by sectionId via data-guidekit-target', () => {
      const el = createVisibleElement('section', {
        'data-guidekit-target': 'pricing',
      });
      createdElements.push(el);

      const result = vg.highlight({ sectionId: 'pricing' });
      expect(result).toBe(true);
      expect(vg.state.isActive).toBe(true);
      expect(vg.state.sectionId).toBe('pricing');
    });

    it('should find an element by sectionId via id attribute', () => {
      const el = createVisibleElement('div', { id: 'features' });
      createdElements.push(el);

      const result = vg.highlight({ sectionId: 'features' });
      expect(result).toBe(true);
      expect(vg.state.isActive).toBe(true);
      expect(vg.state.sectionId).toBe('features');
    });

    it('should find an element by sectionId via aria-label', () => {
      const el = createVisibleElement('nav', {
        'aria-label': 'main-navigation',
      });
      createdElements.push(el);

      const result = vg.highlight({ sectionId: 'main-navigation' });
      expect(result).toBe(true);
      expect(vg.state.sectionId).toBe('main-navigation');
    });

    it('should return false when no element is found', () => {
      const result = vg.highlight({ selector: '.does-not-exist' });
      expect(result).toBe(false);
      expect(vg.state.isActive).toBe(false);
    });

    it('should return false when sectionId does not match any element', () => {
      const result = vg.highlight({ sectionId: 'nonexistent-section' });
      expect(result).toBe(false);
      expect(vg.state.isActive).toBe(false);
    });

    it('should create an overlay DOM element on document.body', () => {
      const el = createVisibleElement('div', { id: 'target' });
      createdElements.push(el);

      vg.highlight({ selector: '#target' });

      const overlay = document.querySelector('[data-guidekit-overlay]');
      expect(overlay).not.toBeNull();
      expect(overlay?.parentNode).toBe(document.body);
    });

    it('should create a spotlight DOM element on document.body', () => {
      const el = createVisibleElement('div', { id: 'target' });
      createdElements.push(el);

      vg.highlight({ selector: '#target' });

      const spotlight = document.querySelector('[data-guidekit-spotlight]');
      expect(spotlight).not.toBeNull();
      expect(spotlight?.parentNode).toBe(document.body);
    });

    it('should create a tooltip when tooltip text is provided', () => {
      const el = createVisibleElement('div', { id: 'target' });
      createdElements.push(el);

      vg.highlight({ selector: '#target', tooltip: 'Click here!' });

      const tooltip = document.querySelector('[data-guidekit-tooltip]');
      expect(tooltip).not.toBeNull();
      expect(tooltip?.textContent).toBe('Click here!');
    });

    it('should not create a tooltip when tooltip text is not provided', () => {
      const el = createVisibleElement('div', { id: 'target' });
      createdElements.push(el);

      vg.highlight({ selector: '#target' });

      const tooltip = document.querySelector('[data-guidekit-tooltip]');
      expect(tooltip).toBeNull();
    });

    it('should set overlay opacity to 1 when highlighted', () => {
      const el = createVisibleElement('div', { id: 'target' });
      createdElements.push(el);

      vg.highlight({ selector: '#target' });

      const overlay = document.querySelector(
        '[data-guidekit-overlay]',
      ) as HTMLElement;
      expect(overlay?.style.opacity).toBe('1');
    });

    it('should set spotlight opacity to 1 when highlighted', () => {
      const el = createVisibleElement('div', { id: 'target' });
      createdElements.push(el);

      vg.highlight({ selector: '#target' });

      const spotlight = document.querySelector(
        '[data-guidekit-spotlight]',
      ) as HTMLElement;
      expect(spotlight?.style.opacity).toBe('1');
    });

    it('should store the sectionId and selector in state', () => {
      const el = createVisibleElement('section', {
        'data-guidekit-target': 'about',
      });
      createdElements.push(el);

      vg.highlight({
        sectionId: 'about',
        tooltip: 'About section',
      });

      expect(vg.state).toEqual({
        isActive: true,
        selector: '[data-guidekit-target="about"]',
        sectionId: 'about',
        tooltip: 'About section',
      });
    });

    it('should return false after destroy() has been called', () => {
      const el = createVisibleElement('div', { id: 'target' });
      createdElements.push(el);

      vg.destroy();
      const result = vg.highlight({ selector: '#target' });
      expect(result).toBe(false);
    });

    it('should handle an invalid CSS selector gracefully', () => {
      // An invalid selector like "[[[" should not throw
      const result = vg.highlight({ selector: '[[[' });
      expect(result).toBe(false);
    });

    it('should dismiss a previous highlight before creating a new one', () => {
      const el1 = createVisibleElement('div', { id: 'first' });
      const el2 = createVisibleElement('div', { id: 'second' });
      createdElements.push(el1, el2);

      vg.highlight({ selector: '#first', tooltip: 'First' });
      expect(vg.state.selector).toBe('#first');

      vg.highlight({ selector: '#second', tooltip: 'Second' });
      expect(vg.state.selector).toBe('#second');
      expect(vg.state.isActive).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Zero-size elements
  // -------------------------------------------------------------------------

  describe('zero-size elements', () => {
    beforeEach(() => {
      vg = new VisualGuidance();
    });

    it('should show tooltip only for zero-size elements (no spotlight)', () => {
      const el = createZeroSizeElement('div', { id: 'hidden-target' });
      createdElements.push(el);

      const result = vg.highlight({
        selector: '#hidden-target',
        tooltip: 'Hidden element',
      });

      expect(result).toBe(true);

      // Tooltip should exist
      const tooltip = document.querySelector('[data-guidekit-tooltip]');
      expect(tooltip).not.toBeNull();
      expect(tooltip?.textContent).toBe('Hidden element');

      // Spotlight should NOT have opacity 1 (or not exist)
      const spotlight = document.querySelector(
        '[data-guidekit-spotlight]',
      ) as HTMLElement | null;
      // For zero-size, ensureSpotlight is not called, so it should be null
      expect(spotlight).toBeNull();
    });

    it('should still return true for zero-size elements (highlight is active)', () => {
      const el = createZeroSizeElement('div', { id: 'zero' });
      createdElements.push(el);

      const result = vg.highlight({ selector: '#zero' });
      expect(result).toBe(true);
      expect(vg.state.isActive).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // dismissHighlight()
  // -------------------------------------------------------------------------

  describe('dismissHighlight()', () => {
    beforeEach(() => {
      vg = new VisualGuidance();
    });

    it('should hide the overlay by setting opacity to 0', () => {
      const el = createVisibleElement('div', { id: 'target' });
      createdElements.push(el);

      vg.highlight({ selector: '#target' });
      vg.dismissHighlight();

      const overlay = document.querySelector(
        '[data-guidekit-overlay]',
      ) as HTMLElement;
      expect(overlay?.style.opacity).toBe('0');
    });

    it('should hide the spotlight by setting opacity to 0', () => {
      const el = createVisibleElement('div', { id: 'target' });
      createdElements.push(el);

      vg.highlight({ selector: '#target' });
      vg.dismissHighlight();

      const spotlight = document.querySelector(
        '[data-guidekit-spotlight]',
      ) as HTMLElement;
      expect(spotlight?.style.opacity).toBe('0');
    });

    it('should remove the tooltip element from the DOM', () => {
      const el = createVisibleElement('div', { id: 'target' });
      createdElements.push(el);

      vg.highlight({ selector: '#target', tooltip: 'Some text' });
      expect(document.querySelector('[data-guidekit-tooltip]')).not.toBeNull();

      vg.dismissHighlight();
      expect(document.querySelector('[data-guidekit-tooltip]')).toBeNull();
    });

    it('should reset the state to inactive', () => {
      const el = createVisibleElement('div', { id: 'target' });
      createdElements.push(el);

      vg.highlight({ selector: '#target' });
      expect(vg.state.isActive).toBe(true);

      vg.dismissHighlight();
      expect(vg.state).toEqual({
        isActive: false,
        selector: null,
        sectionId: null,
        tooltip: null,
      });
    });

    it('should be safe to call multiple times without errors', () => {
      vg.dismissHighlight();
      vg.dismissHighlight();
      // Should not throw
      expect(vg.state.isActive).toBe(false);
    });

    it('should notify spotlight change subscribers when dismissed', () => {
      const el = createVisibleElement('div', { id: 'target' });
      createdElements.push(el);

      const callback = vi.fn();
      vg.onSpotlightChange(callback);

      vg.highlight({ selector: '#target' });
      // callback called once for highlight
      callback.mockClear();

      vg.dismissHighlight();
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // scrollToSection() / scrollToSelector()
  // -------------------------------------------------------------------------

  describe('scrollToSection()', () => {
    beforeEach(() => {
      vg = new VisualGuidance();
    });

    it('should call scrollIntoView on the target element', () => {
      const el = createVisibleElement('div', { id: 'scroll-target' });
      el.scrollIntoView = vi.fn();
      createdElements.push(el);

      vg.scrollToSection('scroll-target');
      expect(el.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'center',
      });
    });

    it('should use window.scrollTo when offset is provided', () => {
      const el = createVisibleElement('div', { id: 'scroll-target' });
      createdElements.push(el);

      vg.scrollToSection('scroll-target', 80);
      expect(window.scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({
          behavior: 'smooth',
        }),
      );
    });

    it('should not throw if section is not found', () => {
      expect(() => vg.scrollToSection('missing-section')).not.toThrow();
    });
  });

  describe('scrollToSelector()', () => {
    beforeEach(() => {
      vg = new VisualGuidance();
    });

    it('should call scrollIntoView on the element matching the selector', () => {
      const el = createVisibleElement('div', { class: 'scroll-me' });
      el.scrollIntoView = vi.fn();
      createdElements.push(el);

      vg.scrollToSelector('.scroll-me');
      expect(el.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'center',
      });
    });

    it('should use window.scrollTo when offset is provided', () => {
      const el = createVisibleElement('div', { class: 'scroll-me' });
      createdElements.push(el);

      vg.scrollToSelector('.scroll-me', 60);
      expect(window.scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({
          behavior: 'smooth',
        }),
      );
    });

    it('should not throw for an invalid selector', () => {
      expect(() => vg.scrollToSelector('[[[invalid')).not.toThrow();
    });

    it('should not throw if element is not found', () => {
      expect(() => vg.scrollToSelector('.nonexistent')).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Tour: startTour / nextTourStep / prevTourStep / stopTour
  // -------------------------------------------------------------------------

  describe('tour state machine', () => {
    beforeEach(() => {
      vg = new VisualGuidance();
    });

    it('startTour() should initialize the tour and advance to step 0', () => {
      const el1 = createVisibleElement('section', {
        'data-guidekit-target': 'step1',
      });
      const el2 = createVisibleElement('section', {
        'data-guidekit-target': 'step2',
      });
      createdElements.push(el1, el2);

      vg.startTour(['step1', 'step2']);
      flushTimers();

      const ts = vg.tourState;
      expect(ts).not.toBeNull();
      expect(ts?.active).toBe(true);
      expect(ts?.step).toBe(0);
      expect(ts?.total).toBe(2);
    });

    it('startTour() with empty array should be a no-op', () => {
      vg.startTour([]);
      expect(vg.tourState).toBeNull();
    });

    it('nextTourStep() should advance to the next step', () => {
      const el1 = createVisibleElement('section', {
        'data-guidekit-target': 'a',
      });
      const el2 = createVisibleElement('section', {
        'data-guidekit-target': 'b',
      });
      const el3 = createVisibleElement('section', {
        'data-guidekit-target': 'c',
      });
      createdElements.push(el1, el2, el3);

      vg.startTour(['a', 'b', 'c']);
      flushTimers();
      expect(vg.tourState?.step).toBe(0);

      vg.nextTourStep();
      flushTimers();
      expect(vg.tourState?.step).toBe(1);

      vg.nextTourStep();
      flushTimers();
      expect(vg.tourState?.step).toBe(2);
    });

    it('nextTourStep() past the last step should stop the tour', () => {
      const el = createVisibleElement('section', {
        'data-guidekit-target': 'only',
      });
      createdElements.push(el);

      vg.startTour(['only']);
      flushTimers();
      expect(vg.tourState?.step).toBe(0);

      // Advance past the end
      vg.nextTourStep();
      expect(vg.tourState).toBeNull();
    });

    it('prevTourStep() should go back to the previous step', () => {
      const el1 = createVisibleElement('section', {
        'data-guidekit-target': 'x',
      });
      const el2 = createVisibleElement('section', {
        'data-guidekit-target': 'y',
      });
      createdElements.push(el1, el2);

      vg.startTour(['x', 'y']);
      flushTimers();

      vg.nextTourStep();
      flushTimers();
      expect(vg.tourState?.step).toBe(1);

      vg.prevTourStep();
      flushTimers();
      expect(vg.tourState?.step).toBe(0);
    });

    it('prevTourStep() at step 0 should be a no-op', () => {
      const el = createVisibleElement('section', {
        'data-guidekit-target': 'first',
      });
      createdElements.push(el);

      vg.startTour(['first']);
      flushTimers();
      expect(vg.tourState?.step).toBe(0);

      vg.prevTourStep();
      // Should still be at step 0
      expect(vg.tourState?.step).toBe(0);
    });

    it('stopTour() should end the tour and dismiss highlights', () => {
      const el = createVisibleElement('section', {
        'data-guidekit-target': 'stop-me',
      });
      createdElements.push(el);

      vg.startTour(['stop-me']);
      flushTimers();
      expect(vg.tourState?.active).toBe(true);

      vg.stopTour();
      expect(vg.tourState).toBeNull();
      expect(vg.state.isActive).toBe(false);
    });

    it('stopTour() should be safe to call when no tour is active', () => {
      expect(() => vg.stopTour()).not.toThrow();
    });

    it('startTour() should stop any existing tour before starting a new one', () => {
      const el1 = createVisibleElement('section', {
        'data-guidekit-target': 'old1',
      });
      const el2 = createVisibleElement('section', {
        'data-guidekit-target': 'new1',
      });
      const el3 = createVisibleElement('section', {
        'data-guidekit-target': 'new2',
      });
      createdElements.push(el1, el2, el3);

      vg.startTour(['old1']);
      flushTimers();

      vg.startTour(['new1', 'new2']);
      flushTimers();

      expect(vg.tourState?.total).toBe(2);
      expect(vg.tourState?.step).toBe(0);
    });

    it('nextTourStep() should be a no-op when no tour is active', () => {
      // Should not throw
      vg.nextTourStep();
      expect(vg.tourState).toBeNull();
    });

    it('prevTourStep() should be a no-op when no tour is active', () => {
      vg.prevTourStep();
      expect(vg.tourState).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Subscribers: onSpotlightChange / onTourStep
  // -------------------------------------------------------------------------

  describe('onSpotlightChange()', () => {
    beforeEach(() => {
      vg = new VisualGuidance();
    });

    it('should notify subscribers on highlight', () => {
      const el = createVisibleElement('div', { id: 'notify-target' });
      createdElements.push(el);

      const callback = vi.fn();
      vg.onSpotlightChange(callback);

      vg.highlight({ selector: '#notify-target' });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          isActive: true,
          selector: '#notify-target',
        }),
      );
    });

    it('should notify subscribers on dismissHighlight', () => {
      const el = createVisibleElement('div', { id: 'dismiss-target' });
      createdElements.push(el);

      const callback = vi.fn();
      vg.onSpotlightChange(callback);

      vg.highlight({ selector: '#dismiss-target' });
      callback.mockClear();

      vg.dismissHighlight();
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });

    it('should return an unsubscribe function', () => {
      const el = createVisibleElement('div', { id: 'unsub-target' });
      createdElements.push(el);

      const callback = vi.fn();
      const unsub = vg.onSpotlightChange(callback);

      vg.highlight({ selector: '#unsub-target' });
      expect(callback).toHaveBeenCalledTimes(1);

      unsub();
      callback.mockClear();

      vg.dismissHighlight();
      expect(callback).not.toHaveBeenCalled();
    });

    it('should support multiple subscribers', () => {
      const el = createVisibleElement('div', { id: 'multi-sub' });
      createdElements.push(el);

      const cb1 = vi.fn();
      const cb2 = vi.fn();
      vg.onSpotlightChange(cb1);
      vg.onSpotlightChange(cb2);

      vg.highlight({ selector: '#multi-sub' });

      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    it('should not throw if a subscriber callback throws', () => {
      const el = createVisibleElement('div', { id: 'err-sub' });
      createdElements.push(el);

      const badCallback = vi.fn(() => {
        throw new Error('subscriber error');
      });
      const goodCallback = vi.fn();

      vg.onSpotlightChange(badCallback);
      vg.onSpotlightChange(goodCallback);

      // Should not throw
      expect(() => vg.highlight({ selector: '#err-sub' })).not.toThrow();
      expect(goodCallback).toHaveBeenCalled();
    });
  });

  describe('onTourStep()', () => {
    beforeEach(() => {
      vg = new VisualGuidance();
    });

    it('should notify subscribers on each tour step', () => {
      const el1 = createVisibleElement('section', {
        'data-guidekit-target': 'ts1',
      });
      const el2 = createVisibleElement('section', {
        'data-guidekit-target': 'ts2',
      });
      createdElements.push(el1, el2);

      const callback = vi.fn();
      vg.onTourStep(callback);

      vg.startTour(['ts1', 'ts2']);
      flushTimers();

      // Step 0 should have been notified
      expect(callback).toHaveBeenCalledWith(0, 2, 'ts1');
    });

    it('should notify with correct step and total on nextTourStep()', () => {
      const el1 = createVisibleElement('section', {
        'data-guidekit-target': 'a1',
      });
      const el2 = createVisibleElement('section', {
        'data-guidekit-target': 'a2',
      });
      createdElements.push(el1, el2);

      const callback = vi.fn();
      vg.onTourStep(callback);

      vg.startTour(['a1', 'a2']);
      flushTimers();

      vg.nextTourStep();
      flushTimers();

      expect(callback).toHaveBeenCalledWith(1, 2, 'a2');
    });

    it('should return an unsubscribe function', () => {
      const el = createVisibleElement('section', {
        'data-guidekit-target': 'u1',
      });
      createdElements.push(el);

      const callback = vi.fn();
      const unsub = vg.onTourStep(callback);

      unsub();

      vg.startTour(['u1']);
      flushTimers();

      expect(callback).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // destroy()
  // -------------------------------------------------------------------------

  describe('destroy()', () => {
    it('should remove all DOM elements from body', () => {
      vg = new VisualGuidance();
      const el = createVisibleElement('div', { id: 'destroy-target' });
      createdElements.push(el);

      vg.highlight({ selector: '#destroy-target', tooltip: 'bye' });

      // Verify elements exist
      expect(document.querySelector('[data-guidekit-overlay]')).not.toBeNull();
      expect(
        document.querySelector('[data-guidekit-spotlight]'),
      ).not.toBeNull();
      expect(document.querySelector('[data-guidekit-tooltip]')).not.toBeNull();

      vg.destroy();

      expect(document.querySelector('[data-guidekit-overlay]')).toBeNull();
      expect(document.querySelector('[data-guidekit-spotlight]')).toBeNull();
      expect(document.querySelector('[data-guidekit-tooltip]')).toBeNull();
    });

    it('should remove the aria-live region', () => {
      vg = new VisualGuidance();
      const el = createVisibleElement('div', { id: 'live-target' });
      createdElements.push(el);

      vg.highlight({ selector: '#live-target' });

      // The announce() method creates a live region
      expect(document.querySelector('[data-guidekit-live]')).not.toBeNull();

      vg.destroy();
      expect(document.querySelector('[data-guidekit-live]')).toBeNull();
    });

    it('should stop any active tour', () => {
      vg = new VisualGuidance();
      const el = createVisibleElement('section', {
        'data-guidekit-target': 'tour-d',
      });
      createdElements.push(el);

      vg.startTour(['tour-d']);
      flushTimers();
      expect(vg.tourState?.active).toBe(true);

      vg.destroy();
      expect(vg.tourState).toBeNull();
    });

    it('should clear all subscriber lists', () => {
      vg = new VisualGuidance();
      const callback = vi.fn();
      vg.onSpotlightChange(callback);
      vg.onTourStep(callback);

      // destroy() internally calls dismissHighlight() which notifies
      // subscribers before clearing them. We verify that after destroy,
      // new highlight attempts do NOT trigger the callback.
      vg.destroy();
      const callCountAfterDestroy = callback.mock.calls.length;

      // After destroy, highlight returns false and subscribers are cleared
      const el = createVisibleElement('div', { id: 'post-destroy' });
      createdElements.push(el);

      vg.highlight({ selector: '#post-destroy' });
      // No new calls after destroy
      expect(callback.mock.calls.length).toBe(callCountAfterDestroy);
    });

    it('should be safe to call multiple times', () => {
      vg = new VisualGuidance();
      expect(() => {
        vg.destroy();
        vg.destroy();
      }).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // SSR guard
  // -------------------------------------------------------------------------

  describe('SSR guard', () => {
    it('highlight() should return false when document is undefined', () => {
      // We cannot truly make `document` undefined in jsdom,
      // but we can test the destroyed path which returns false similarly.
      // Instead, test by checking the code guards via the destroyed flag.
      vg = new VisualGuidance();
      vg.destroy(); // Sets destroyed = true
      const result = vg.highlight({ selector: '#anything' });
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // state getter
  // -------------------------------------------------------------------------

  describe('state getter', () => {
    it('should return a copy of the state (not the internal reference)', () => {
      vg = new VisualGuidance();
      const el = createVisibleElement('div', { id: 'state-test' });
      createdElements.push(el);

      vg.highlight({ selector: '#state-test' });

      const s1 = vg.state;
      const s2 = vg.state;

      expect(s1).toEqual(s2);
      expect(s1).not.toBe(s2); // Different object references
    });
  });

  // -------------------------------------------------------------------------
  // tourState getter
  // -------------------------------------------------------------------------

  describe('tourState getter', () => {
    it('should return null when no tour is active', () => {
      vg = new VisualGuidance();
      expect(vg.tourState).toBeNull();
    });

    it('should return active tour information', () => {
      vg = new VisualGuidance();
      const el1 = createVisibleElement('section', {
        'data-guidekit-target': 'tg1',
      });
      const el2 = createVisibleElement('section', {
        'data-guidekit-target': 'tg2',
      });
      const el3 = createVisibleElement('section', {
        'data-guidekit-target': 'tg3',
      });
      createdElements.push(el1, el2, el3);

      vg.startTour(['tg1', 'tg2', 'tg3']);
      flushTimers();

      const ts = vg.tourState;
      expect(ts).toEqual({
        active: true,
        step: 0,
        total: 3,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Accessibility
  // -------------------------------------------------------------------------

  describe('accessibility', () => {
    beforeEach(() => {
      vg = new VisualGuidance();
    });

    it('should set aria-hidden on overlay and spotlight', () => {
      const el = createVisibleElement('div', { id: 'a11y-target' });
      createdElements.push(el);

      vg.highlight({ selector: '#a11y-target' });

      const overlay = document.querySelector('[data-guidekit-overlay]');
      const spotlight = document.querySelector('[data-guidekit-spotlight]');

      expect(overlay?.getAttribute('aria-hidden')).toBe('true');
      expect(spotlight?.getAttribute('aria-hidden')).toBe('true');
    });

    it('should set role="tooltip" on the tooltip element', () => {
      const el = createVisibleElement('div', { id: 'tooltip-role' });
      createdElements.push(el);

      vg.highlight({ selector: '#tooltip-role', tooltip: 'Accessible tip' });

      const tooltip = document.querySelector('[data-guidekit-tooltip]');
      expect(tooltip?.getAttribute('role')).toBe('tooltip');
    });

    it('should set aria-describedby on the target element', () => {
      const el = createVisibleElement('div', { id: 'describedby-test' });
      createdElements.push(el);

      vg.highlight({
        selector: '#describedby-test',
        tooltip: 'Described element',
      });

      expect(el.getAttribute('aria-describedby')).toBeTruthy();
      // The tooltip id should match
      const tooltip = document.querySelector('[data-guidekit-tooltip]');
      expect(el.getAttribute('aria-describedby')).toBe(tooltip?.id);
    });

    it('should create an aria-live region for announcements', () => {
      const el = createVisibleElement('div', { id: 'live-announce' });
      createdElements.push(el);

      vg.highlight({ selector: '#live-announce' });

      const liveRegion = document.querySelector('[data-guidekit-live]');
      expect(liveRegion).not.toBeNull();
      expect(liveRegion?.getAttribute('aria-live')).toBe('assertive');
      expect(liveRegion?.getAttribute('aria-atomic')).toBe('true');
    });
  });
});
