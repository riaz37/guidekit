/**
 * @module @guidekit/core/visual
 *
 * Visual Guidance System for the GuideKit SDK.
 * Provides spotlight overlays, tooltips, smooth scrolling, and guided tours
 * to visually direct users to page elements identified by the LLM.
 *
 * Key design decisions:
 * - Overlay lives on document.body (NOT Shadow DOM) so it can cover the entire page.
 * - Uses box-shadow cutout technique for the spotlight effect.
 * - Tracks element position via ResizeObserver + scroll listeners (NOT rAF polling).
 * - All text is set via textContent (never innerHTML) to prevent XSS.
 * - SSR-safe: every browser API is guarded behind typeof checks.
 * - Compositor-only animations (transform, opacity) for smooth 60fps.
 * - Respects prefers-reduced-motion.
 */

import { DOMScanner } from '../dom/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[GuideKit:Visual]';
const DEFAULT_OVERLAY_COLOR = 'rgba(0, 0, 0, 0.5)';
const DEFAULT_SPOTLIGHT_COLOR = '#4a9eed';
const DEFAULT_ANIMATION_DURATION = 300;
const DEFAULT_SPOTLIGHT_PADDING = 8;
const AUTO_TOUR_INTERVAL_MS = 5000;
const TOOLTIP_ARROW_SIZE = 8;
const TOOLTIP_MARGIN = 12;
const OVERLAY_Z_INDEX = 999998;
const TOOLTIP_Z_INDEX = 999999;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VisualGuidanceOptions {
  /** Color of the spotlight overlay. Default: 'rgba(0, 0, 0, 0.5)' */
  overlayColor?: string;
  /** Color of the spotlight cutout border. Default: '#4a9eed' */
  spotlightColor?: string;
  /** Animation duration in ms. Default: 300 */
  animationDuration?: number;
  /** Padding around the highlighted element in px. Default: 8 */
  spotlightPadding?: number;
  /** Enable debug logging. Default: false */
  debug?: boolean;
}

export interface TooltipOptions {
  text: string;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
}

export interface SpotlightState {
  isActive: boolean;
  selector: string | null;
  sectionId: string | null;
  tooltip: string | null;
}

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

// ---------------------------------------------------------------------------
// Utility: Scrollable ancestor detection
// ---------------------------------------------------------------------------

/**
 * Walk up the DOM tree and collect every ancestor that has an overflow
 * style allowing scroll (auto or scroll).
 */
function getScrollableAncestors(element: Element): Element[] {
  if (typeof getComputedStyle === 'undefined') return [];

  const ancestors: Element[] = [];
  let parent = element.parentElement;
  while (parent) {
    const style = getComputedStyle(parent);
    const overflow = style.overflow + style.overflowX + style.overflowY;
    if (/(auto|scroll)/.test(overflow)) {
      ancestors.push(parent);
    }
    parent = parent.parentElement;
  }
  return ancestors;
}

/**
 * Detect whether the user prefers reduced motion.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------------------------------------------------------------------------
// VisualGuidance
// ---------------------------------------------------------------------------

export class VisualGuidance {
  // Configuration
  private readonly overlayColor: string;
  private readonly spotlightColor: string;
  private readonly animationDuration: number;
  private readonly spotlightPadding: number;
  private readonly debug: boolean;

  // DOM elements (created lazily)
  private overlayEl: HTMLDivElement | null = null;
  private spotlightEl: HTMLDivElement | null = null;
  private tooltipEl: HTMLDivElement | null = null;
  private liveRegionEl: HTMLDivElement | null = null;

  // State
  private _state: SpotlightState = {
    isActive: false,
    selector: null,
    sectionId: null,
    tooltip: null,
  };

  // Tracking infrastructure
  private resizeObserver: ResizeObserver | null = null;
  private scrollListenerCleanups: Array<() => void> = [];
  private currentTargetElement: Element | null = null;

  // Tour state
  private tourSectionIds: string[] = [];
  private tourCurrentStep = -1;
  private tourMode: 'auto' | 'manual' = 'manual';
  private tourAutoTimer: ReturnType<typeof setTimeout> | null = null;
  private tourPausedByInteraction = false;

  // Subscribers
  private spotlightChangeCallbacks: Array<(state: SpotlightState) => void> = [];
  private tourStepCallbacks: Array<(step: number, total: number, sectionId: string) => void> = [];

  // DOMScanner for resolving sectionIds
  private domScanner: DOMScanner | null = null;

  // Track whether destroy() has been called
  private destroyed = false;

  constructor(options?: VisualGuidanceOptions) {
    this.overlayColor = options?.overlayColor ?? DEFAULT_OVERLAY_COLOR;
    this.spotlightColor = options?.spotlightColor ?? DEFAULT_SPOTLIGHT_COLOR;
    this.animationDuration = options?.animationDuration ?? DEFAULT_ANIMATION_DURATION;
    this.spotlightPadding = options?.spotlightPadding ?? DEFAULT_SPOTLIGHT_PADDING;
    this.debug = options?.debug ?? false;

    this.log('Initialised', {
      overlayColor: this.overlayColor,
      spotlightColor: this.spotlightColor,
      animationDuration: this.animationDuration,
      spotlightPadding: this.spotlightPadding,
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Highlight an element by selector or sectionId.
   * Returns true if the element was found and highlighted, false otherwise.
   */
  highlight(params: {
    sectionId?: string;
    selector?: string;
    tooltip?: string;
    position?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
  }): boolean {
    if (typeof document === 'undefined') return false;
    if (this.destroyed) return false;

    const { sectionId, selector, tooltip, position } = params;

    // Resolve the target element
    const target = this.resolveTarget(sectionId, selector);
    if (!target) {
      this.log('Target element not found', { sectionId, selector });
      return false;
    }

    const resolvedSelector = selector ?? this.buildSelectorForElement(target);

    // Dismiss any existing highlight first (without notifying to avoid flicker)
    this.cleanupTrackingInfrastructure();

    // Update state
    this._state = {
      isActive: true,
      selector: resolvedSelector,
      sectionId: sectionId ?? null,
      tooltip: tooltip ?? null,
    };

    this.currentTargetElement = target;

    // Check if the element has zero size (e.g., display: none)
    const rect = target.getBoundingClientRect();
    const hasSize = rect.width > 0 && rect.height > 0;

    if (hasSize) {
      // Create/update overlay and spotlight
      this.ensureOverlay();
      this.ensureSpotlight();
      this.positionSpotlight(rect);
      this.showOverlay();
    } else {
      this.log('Element has zero size, showing tooltip only');
    }

    // Show tooltip if requested
    if (tooltip) {
      this.showTooltip(target, tooltip, position ?? 'auto');
    } else {
      this.removeTooltip();
    }

    // Set up position tracking
    this.setupPositionTracking(target);

    // Announce for screen readers
    const label = sectionId ?? resolvedSelector;
    this.announce(`Highlighting ${label}`);

    // Notify subscribers
    this.notifySpotlightChange();

    this.log('Highlighted element', { sectionId, selector: resolvedSelector, tooltip });
    return true;
  }

  /**
   * Remove the spotlight and all associated elements.
   */
  dismissHighlight(): void {
    if (typeof document === 'undefined') return;

    this.cleanupTrackingInfrastructure();
    this.hideOverlay();
    this.removeTooltip();
    this.removeAriaDescribedBy();

    this.currentTargetElement = null;

    this._state = {
      isActive: false,
      selector: null,
      sectionId: null,
      tooltip: null,
    };

    this.notifySpotlightChange();
    this.log('Highlight dismissed');
  }

  /**
   * Smooth scroll to a section by its sectionId.
   */
  scrollToSection(sectionId: string, offset?: number): void {
    if (typeof document === 'undefined') return;

    const target = this.resolveTarget(sectionId, undefined);
    if (!target) {
      this.log('scrollToSection: section not found', { sectionId });
      return;
    }

    this.scrollToElement(target, offset);
    this.log('Scrolled to section', { sectionId });
  }

  /**
   * Smooth scroll to an element by CSS selector.
   */
  scrollToSelector(selector: string, offset?: number): void {
    if (typeof document === 'undefined') return;

    let target: Element | null;
    try {
      target = document.querySelector(selector);
    } catch {
      this.log('scrollToSelector: invalid selector', { selector });
      return;
    }

    if (!target) {
      this.log('scrollToSelector: element not found', { selector });
      return;
    }

    this.scrollToElement(target, offset);
    this.log('Scrolled to selector', { selector });
  }

  /**
   * Start a guided tour through the given section IDs.
   */
  startTour(sectionIds: string[], mode: 'auto' | 'manual' = 'manual'): void {
    if (typeof document === 'undefined') return;
    if (this.destroyed) return;
    if (sectionIds.length === 0) return;

    // Stop any existing tour
    this.stopTour();

    this.tourSectionIds = [...sectionIds];
    this.tourMode = mode;
    this.tourCurrentStep = -1;
    this.tourPausedByInteraction = false;

    this.log('Tour started', { steps: sectionIds.length, mode });

    // Advance to the first step
    this.nextTourStep();
  }

  /**
   * Move to the next tour step. No-op if no tour is active.
   */
  nextTourStep(): void {
    if (this.tourSectionIds.length === 0) return;

    // Clear any existing auto timer
    this.clearAutoTimer();

    const nextStep = this.tourCurrentStep + 1;
    if (nextStep >= this.tourSectionIds.length) {
      // Tour complete
      this.stopTour();
      return;
    }

    this.tourCurrentStep = nextStep;
    this.tourPausedByInteraction = false;

    this.executeTourStep();
  }

  /**
   * Move to the previous tour step. No-op if no tour is active or at first step.
   */
  prevTourStep(): void {
    if (this.tourSectionIds.length === 0) return;
    if (this.tourCurrentStep <= 0) return;

    // Clear any existing auto timer
    this.clearAutoTimer();

    this.tourCurrentStep -= 1;
    this.tourPausedByInteraction = false;

    this.executeTourStep();
  }

  /**
   * Stop the tour and dismiss all highlights.
   */
  stopTour(): void {
    this.clearAutoTimer();

    const wasActive = this.tourSectionIds.length > 0;

    this.tourSectionIds = [];
    this.tourCurrentStep = -1;
    this.tourPausedByInteraction = false;

    this.dismissHighlight();

    if (wasActive) {
      this.log('Tour stopped');
    }
  }

  /**
   * Get the current spotlight state.
   */
  get state(): SpotlightState {
    return { ...this._state };
  }

  /**
   * Get the current tour state, or null if no tour is active.
   */
  get tourState(): { active: boolean; step: number; total: number } | null {
    if (this.tourSectionIds.length === 0) {
      return null;
    }
    return {
      active: true,
      step: this.tourCurrentStep,
      total: this.tourSectionIds.length,
    };
  }

  /**
   * Subscribe to spotlight state changes.
   * Returns an unsubscribe function.
   */
  onSpotlightChange(callback: (state: SpotlightState) => void): () => void {
    this.spotlightChangeCallbacks.push(callback);
    return () => {
      const idx = this.spotlightChangeCallbacks.indexOf(callback);
      if (idx !== -1) {
        this.spotlightChangeCallbacks.splice(idx, 1);
      }
    };
  }

  /**
   * Subscribe to tour step events.
   * Returns an unsubscribe function.
   */
  onTourStep(callback: (step: number, total: number, sectionId: string) => void): () => void {
    this.tourStepCallbacks.push(callback);
    return () => {
      const idx = this.tourStepCallbacks.indexOf(callback);
      if (idx !== -1) {
        this.tourStepCallbacks.splice(idx, 1);
      }
    };
  }

  /**
   * Clean up all DOM elements, observers, and event listeners.
   * After calling destroy(), the instance is unusable.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.stopTour();
    this.dismissHighlight();
    this.cleanupTrackingInfrastructure();

    // Remove overlay
    if (this.overlayEl?.parentNode) {
      this.overlayEl.parentNode.removeChild(this.overlayEl);
    }
    this.overlayEl = null;

    // Remove spotlight
    if (this.spotlightEl?.parentNode) {
      this.spotlightEl.parentNode.removeChild(this.spotlightEl);
    }
    this.spotlightEl = null;

    // Remove tooltip
    this.removeTooltip();

    // Remove live region
    if (this.liveRegionEl?.parentNode) {
      this.liveRegionEl.parentNode.removeChild(this.liveRegionEl);
    }
    this.liveRegionEl = null;

    // Disconnect resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Clear subscriber lists
    this.spotlightChangeCallbacks = [];
    this.tourStepCallbacks = [];

    this.domScanner = null;

    this.log('Destroyed');
  }

  // -------------------------------------------------------------------------
  // Private: Target resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve a target element from either a sectionId or a CSS selector.
   * If sectionId is provided, uses DOMScanner to find the section's selector.
   */
  private resolveTarget(sectionId?: string, selector?: string): Element | null {
    if (typeof document === 'undefined') return null;

    // Try selector first if provided
    if (selector) {
      try {
        const el = document.querySelector(selector);
        if (el) return el;
      } catch {
        this.log('Invalid selector', { selector });
      }
    }

    // Try sectionId via DOMScanner
    if (sectionId) {
      // Try common patterns: data-guidekit-target, id, aria-label
      const strategies = [
        `[data-guidekit-target="${sectionId}"]`,
        `#${CSS.escape(sectionId)}`,
        `[aria-label="${sectionId}"]`,
      ];

      for (const strategy of strategies) {
        try {
          const el = document.querySelector(strategy);
          if (el) return el;
        } catch {
          // Invalid selector, try next
        }
      }

      // Fall back to DOMScanner for a full scan
      if (!this.domScanner) {
        this.domScanner = new DOMScanner({ debug: this.debug });
      }
      const model = this.domScanner.scan();
      const section = model.sections.find((s) => s.id === sectionId);
      if (section) {
        try {
          const el = document.querySelector(section.selector);
          if (el) return el;
        } catch {
          this.log('DOMScanner selector invalid', { selector: section.selector });
        }
      }
    }

    return null;
  }

  /**
   * Build a CSS selector for an element, using the same priority hierarchy
   * as the DOMScanner.
   */
  private buildSelectorForElement(el: Element): string {
    const guideKitTarget = el.getAttribute('data-guidekit-target');
    if (guideKitTarget) return `[data-guidekit-target="${guideKitTarget}"]`;

    const id = el.id;
    if (id) {
      try {
        const escaped = CSS.escape(id);
        if (document.querySelectorAll(`#${escaped}`).length === 1) {
          return `#${escaped}`;
        }
      } catch {
        // Fall through
      }
    }

    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${testId}"]`;

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return `[aria-label="${ariaLabel}"]`;

    // Structural path fallback
    return this.buildStructuralPath(el);
  }

  private buildStructuralPath(el: Element): string {
    if (typeof document === 'undefined') return '';

    const parts: string[] = [];
    let current: Element | null = el;

    while (current && current !== document.documentElement) {
      const tag = current.tagName.toLowerCase();

      if (tag === 'body' || tag === 'html') {
        parts.unshift(tag);
        current = current.parentElement;
        continue;
      }

      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === current!.tagName,
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          parts.unshift(`${tag}:nth-child(${index})`);
        } else {
          parts.unshift(tag);
        }
      } else {
        parts.unshift(tag);
      }

      current = parent;
    }

    return parts.join(' > ');
  }

  // -------------------------------------------------------------------------
  // Private: Overlay management
  // -------------------------------------------------------------------------

  /**
   * Ensure the full-page overlay element exists on document.body.
   */
  private ensureOverlay(): void {
    if (typeof document === 'undefined') return;
    if (this.overlayEl) return;

    const overlay = document.createElement('div');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.setAttribute('data-guidekit-overlay', 'true');
    overlay.style.cssText = [
      'position: fixed',
      'inset: 0',
      `z-index: ${OVERLAY_Z_INDEX}`,
      'pointer-events: none',
      'opacity: 0',
      `transition: opacity ${this.getTransitionDuration()}ms ease-out`,
    ].join('; ');

    document.body.appendChild(overlay);
    this.overlayEl = overlay;
  }

  /**
   * Ensure the spotlight (cutout) element exists on document.body.
   */
  private ensureSpotlight(): void {
    if (typeof document === 'undefined') return;
    if (this.spotlightEl) return;

    const spotlight = document.createElement('div');
    spotlight.setAttribute('aria-hidden', 'true');
    spotlight.setAttribute('data-guidekit-spotlight', 'true');

    const transitionDuration = this.getTransitionDuration();
    spotlight.style.cssText = [
      'position: fixed',
      `z-index: ${OVERLAY_Z_INDEX}`,
      'pointer-events: none',
      'border-radius: 4px',
      `border: 2px solid ${this.spotlightColor}`,
      `box-shadow: 0 0 0 9999px ${this.overlayColor}`,
      'will-change: transform, opacity',
      'opacity: 0',
      `transition: transform ${transitionDuration}ms ease-out, opacity ${transitionDuration}ms ease-out, width ${transitionDuration}ms ease-out, height ${transitionDuration}ms ease-out`,
    ].join('; ');

    document.body.appendChild(spotlight);
    this.spotlightEl = spotlight;
  }

  /**
   * Position the spotlight element over the target's bounding rect.
   */
  private positionSpotlight(rect: DOMRect): void {
    if (!this.spotlightEl) return;

    const pad = this.spotlightPadding;
    const left = rect.left - pad;
    const top = rect.top - pad;
    const width = rect.width + pad * 2;
    const height = rect.height + pad * 2;

    this.spotlightEl.style.left = `${left}px`;
    this.spotlightEl.style.top = `${top}px`;
    this.spotlightEl.style.width = `${width}px`;
    this.spotlightEl.style.height = `${height}px`;
  }

  /**
   * Show the overlay and spotlight with entrance animation.
   */
  private showOverlay(): void {
    if (typeof document === 'undefined') return;

    // Force a reflow so the transition triggers
    if (this.overlayEl) {
      void this.overlayEl.offsetHeight;
      this.overlayEl.style.opacity = '1';
    }
    if (this.spotlightEl) {
      void this.spotlightEl.offsetHeight;
      this.spotlightEl.style.opacity = '1';
    }
  }

  /**
   * Hide the overlay and spotlight.
   */
  private hideOverlay(): void {
    if (this.overlayEl) {
      this.overlayEl.style.opacity = '0';
    }
    if (this.spotlightEl) {
      this.spotlightEl.style.opacity = '0';
    }
  }

  // -------------------------------------------------------------------------
  // Private: Tooltip management
  // -------------------------------------------------------------------------

  /**
   * Show a tooltip near the target element.
   */
  private showTooltip(
    target: Element,
    text: string,
    positionPref: 'top' | 'bottom' | 'left' | 'right' | 'auto',
  ): void {
    if (typeof document === 'undefined') return;

    // Create or reuse tooltip element
    if (!this.tooltipEl) {
      const tooltip = document.createElement('div');
      tooltip.setAttribute('role', 'tooltip');
      tooltip.setAttribute('data-guidekit-tooltip', 'true');

      const transitionDuration = this.getTransitionDuration();
      tooltip.style.cssText = [
        'position: fixed',
        `z-index: ${TOOLTIP_Z_INDEX}`,
        'pointer-events: none',
        'background: #ffffff',
        'color: #1a1a2e',
        'padding: 10px 14px',
        'border-radius: 8px',
        'font-size: 14px',
        'line-height: 1.4',
        'max-width: 300px',
        'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15)',
        'opacity: 0',
        `transition: opacity ${transitionDuration}ms ease-out`,
        'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      ].join('; ');

      document.body.appendChild(tooltip);
      this.tooltipEl = tooltip;
    }

    // Set text content (NEVER innerHTML to prevent XSS)
    this.tooltipEl.textContent = text;

    // Add step indicator if in a tour
    if (this.tourSectionIds.length > 0 && this.tourCurrentStep >= 0) {
      const stepText = `Step ${this.tourCurrentStep + 1} of ${this.tourSectionIds.length}`;
      this.tooltipEl.textContent = `${stepText}: ${text}`;
    }

    // Set aria-describedby on the target
    const tooltipId = 'guidekit-tooltip-' + Date.now();
    this.tooltipEl.id = tooltipId;
    if (target instanceof HTMLElement) {
      target.setAttribute('aria-describedby', tooltipId);
    }

    // Position the tooltip
    const rect = target.getBoundingClientRect();
    const position = positionPref === 'auto'
      ? this.computeAutoPosition(rect)
      : positionPref;

    this.positionTooltip(rect, position);

    // Animate in
    void this.tooltipEl.offsetHeight;
    this.tooltipEl.style.opacity = '1';
  }

  /**
   * Remove the tooltip element from the DOM.
   */
  private removeTooltip(): void {
    if (this.tooltipEl?.parentNode) {
      this.tooltipEl.parentNode.removeChild(this.tooltipEl);
    }
    this.tooltipEl = null;
  }

  /**
   * Remove aria-describedby from the current target element.
   */
  private removeAriaDescribedBy(): void {
    if (this.currentTargetElement instanceof HTMLElement) {
      this.currentTargetElement.removeAttribute('aria-describedby');
    }
  }

  /**
   * Compute the best auto-position for the tooltip relative to the target rect.
   * Preference order: bottom, top, right, left.
   */
  private computeAutoPosition(rect: DOMRect): TooltipPosition {
    if (typeof window === 'undefined') return 'bottom';

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const spaceRight = viewportWidth - rect.right;
    const spaceLeft = rect.left;

    const minSpace = 80; // Minimum space needed for tooltip

    // Prefer bottom
    if (spaceBelow >= minSpace) return 'bottom';
    // Then top
    if (spaceAbove >= minSpace) return 'top';
    // Then right
    if (spaceRight >= minSpace) return 'right';
    // Then left
    if (spaceLeft >= minSpace) return 'left';

    // Default to bottom even if tight
    return 'bottom';
  }

  /**
   * Position the tooltip element relative to the target rect.
   */
  private positionTooltip(rect: DOMRect, position: TooltipPosition): void {
    if (!this.tooltipEl || typeof window === 'undefined') return;

    const pad = this.spotlightPadding;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // We need the tooltip's dimensions. Force layout to measure.
    this.tooltipEl.style.left = '0px';
    this.tooltipEl.style.top = '0px';
    const tooltipRect = this.tooltipEl.getBoundingClientRect();
    const tw = tooltipRect.width;
    const th = tooltipRect.height;

    let left = 0;
    let top = 0;

    switch (position) {
      case 'bottom':
        left = rect.left + rect.width / 2 - tw / 2;
        top = rect.bottom + pad + TOOLTIP_ARROW_SIZE + TOOLTIP_MARGIN;
        break;
      case 'top':
        left = rect.left + rect.width / 2 - tw / 2;
        top = rect.top - pad - th - TOOLTIP_ARROW_SIZE - TOOLTIP_MARGIN;
        break;
      case 'right':
        left = rect.right + pad + TOOLTIP_ARROW_SIZE + TOOLTIP_MARGIN;
        top = rect.top + rect.height / 2 - th / 2;
        break;
      case 'left':
        left = rect.left - pad - tw - TOOLTIP_ARROW_SIZE - TOOLTIP_MARGIN;
        top = rect.top + rect.height / 2 - th / 2;
        break;
    }

    // Clamp within viewport
    left = Math.max(8, Math.min(left, viewportWidth - tw - 8));
    top = Math.max(8, Math.min(top, viewportHeight - th - 8));

    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${top}px`;

    // Remove any existing arrow pseudo-element styling (via data attribute)
    this.tooltipEl.setAttribute('data-guidekit-position', position);

    // Apply arrow using a CSS trick with box-shadow on a pseudo :before
    // Since we can't use CSS stylesheets easily, we inline arrow via border trick
    this.applyTooltipArrow(position, rect);
  }

  /**
   * Apply an arrow on the tooltip pointing toward the target element.
   * Uses a child div with CSS border triangle technique.
   */
  private applyTooltipArrow(position: TooltipPosition, targetRect: DOMRect): void {
    if (!this.tooltipEl) return;

    // Remove any existing arrow
    const existingArrow = this.tooltipEl.querySelector('[data-guidekit-arrow]');
    if (existingArrow) {
      existingArrow.remove();
    }

    const arrow = document.createElement('div');
    arrow.setAttribute('data-guidekit-arrow', 'true');
    arrow.setAttribute('aria-hidden', 'true');

    const size = TOOLTIP_ARROW_SIZE;
    const baseStyle = [
      'position: absolute',
      'width: 0',
      'height: 0',
      'border-style: solid',
    ];

    switch (position) {
      case 'bottom':
        arrow.style.cssText = [
          ...baseStyle,
          `border-width: 0 ${size}px ${size}px ${size}px`,
          `border-color: transparent transparent #ffffff transparent`,
          `top: -${size}px`,
          `left: 50%`,
          `margin-left: -${size}px`,
        ].join('; ');
        // Adjust arrow horizontal position to point at target center
        this.adjustArrowHorizontal(arrow, targetRect, size);
        break;
      case 'top':
        arrow.style.cssText = [
          ...baseStyle,
          `border-width: ${size}px ${size}px 0 ${size}px`,
          `border-color: #ffffff transparent transparent transparent`,
          `bottom: -${size}px`,
          `left: 50%`,
          `margin-left: -${size}px`,
        ].join('; ');
        this.adjustArrowHorizontal(arrow, targetRect, size);
        break;
      case 'right':
        arrow.style.cssText = [
          ...baseStyle,
          `border-width: ${size}px ${size}px ${size}px 0`,
          `border-color: transparent #ffffff transparent transparent`,
          `left: -${size}px`,
          `top: 50%`,
          `margin-top: -${size}px`,
        ].join('; ');
        break;
      case 'left':
        arrow.style.cssText = [
          ...baseStyle,
          `border-width: ${size}px 0 ${size}px ${size}px`,
          `border-color: transparent transparent transparent #ffffff`,
          `right: -${size}px`,
          `top: 50%`,
          `margin-top: -${size}px`,
        ].join('; ');
        break;
    }

    this.tooltipEl.appendChild(arrow);
  }

  /**
   * Adjust arrow horizontal position so it points toward the target center
   * even when the tooltip is clamped to viewport edges.
   */
  private adjustArrowHorizontal(arrow: HTMLDivElement, targetRect: DOMRect, size: number): void {
    if (!this.tooltipEl) return;

    const tooltipRect = this.tooltipEl.getBoundingClientRect();
    const targetCenter = targetRect.left + targetRect.width / 2;
    const arrowLeft = targetCenter - tooltipRect.left;

    // Clamp arrow within tooltip bounds
    const minLeft = size + 4;
    const maxLeft = tooltipRect.width - size - 4;
    const clampedLeft = Math.max(minLeft, Math.min(arrowLeft, maxLeft));

    arrow.style.left = `${clampedLeft}px`;
    arrow.style.marginLeft = `0`;
  }

  // -------------------------------------------------------------------------
  // Private: Position tracking
  // -------------------------------------------------------------------------

  /**
   * Set up ResizeObserver and scroll listeners to track the target element
   * and update spotlight/tooltip positions.
   */
  private setupPositionTracking(target: Element): void {
    this.cleanupTrackingInfrastructure();

    // ResizeObserver
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.updatePositions();
      });
      this.resizeObserver.observe(target);
      // Also observe body for layout changes
      if (typeof document !== 'undefined') {
        this.resizeObserver.observe(document.body);
      }
    }

    // Scroll listeners on all scrollable ancestors + window
    const scrollableAncestors = getScrollableAncestors(target);

    const handleScroll = (): void => {
      this.updatePositions();

      // In auto-tour mode, pause on user interaction
      if (this.tourMode === 'auto' && !this.tourPausedByInteraction) {
        this.tourPausedByInteraction = true;
        this.clearAutoTimer();
        // Resume after a delay
        this.tourAutoTimer = setTimeout(() => {
          this.tourPausedByInteraction = false;
          this.scheduleAutoAdvance();
        }, AUTO_TOUR_INTERVAL_MS);
      }
    };

    // Attach to each scrollable ancestor
    for (const ancestor of scrollableAncestors) {
      ancestor.addEventListener('scroll', handleScroll, { passive: true });
      this.scrollListenerCleanups.push(() => {
        ancestor.removeEventListener('scroll', handleScroll);
      });
    }

    // Always attach to window for document-level scroll
    if (typeof window !== 'undefined') {
      window.addEventListener('scroll', handleScroll, { passive: true });
      this.scrollListenerCleanups.push(() => {
        window.removeEventListener('scroll', handleScroll);
      });

      // Also listen for window resize
      window.addEventListener('resize', handleScroll, { passive: true });
      this.scrollListenerCleanups.push(() => {
        window.removeEventListener('resize', handleScroll);
      });
    }
  }

  /**
   * Remove all tracking observers and event listeners.
   */
  private cleanupTrackingInfrastructure(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    for (const cleanup of this.scrollListenerCleanups) {
      cleanup();
    }
    this.scrollListenerCleanups = [];
  }

  /**
   * Update spotlight and tooltip positions based on the current target
   * element's bounding rect.
   */
  private updatePositions(): void {
    if (!this.currentTargetElement) return;

    const rect = this.currentTargetElement.getBoundingClientRect();
    const hasSize = rect.width > 0 && rect.height > 0;

    if (hasSize && this.spotlightEl) {
      this.positionSpotlight(rect);
    }

    if (this.tooltipEl && this._state.tooltip) {
      const position = this.tooltipEl.getAttribute('data-guidekit-position') as TooltipPosition | null;
      this.positionTooltip(rect, position ?? 'bottom');
    }
  }

  // -------------------------------------------------------------------------
  // Private: Smooth scrolling
  // -------------------------------------------------------------------------

  /**
   * Scroll to an element, respecting reduced motion preferences.
   */
  private scrollToElement(target: Element, offset?: number): void {
    if (typeof window === 'undefined') return;

    const behavior = prefersReducedMotion() ? 'instant' as ScrollBehavior : 'smooth';

    if (offset !== undefined && offset !== 0) {
      // Use window.scrollTo with calculated position for header offset
      const rect = target.getBoundingClientRect();
      const scrollTop = window.pageYOffset ?? document.documentElement.scrollTop;
      const targetTop = rect.top + scrollTop - offset;

      window.scrollTo({
        top: targetTop,
        behavior,
      });
    } else {
      target.scrollIntoView({
        behavior,
        block: 'center',
      });
    }
  }

  // -------------------------------------------------------------------------
  // Private: Tour logic
  // -------------------------------------------------------------------------

  /**
   * Execute the current tour step: scroll to and highlight the section.
   */
  private executeTourStep(): void {
    if (this.tourCurrentStep < 0 || this.tourCurrentStep >= this.tourSectionIds.length) {
      return;
    }

    const sectionId = this.tourSectionIds[this.tourCurrentStep] as string | undefined;
    if (!sectionId) return;

    const total = this.tourSectionIds.length;
    const step = this.tourCurrentStep;

    // Scroll to the section first
    this.scrollToSection(sectionId);

    // Slight delay to let scroll settle, then highlight
    // Use a timeout so scrollIntoView can initiate
    setTimeout(() => {
      if (this.destroyed) return;

      const tooltipText = `Step ${step + 1} of ${total}`;

      this.highlight({
        sectionId,
        tooltip: tooltipText,
        position: 'auto',
      });

      // Notify tour step subscribers
      for (const cb of this.tourStepCallbacks) {
        try {
          cb(step, total, sectionId);
        } catch (e) {
          this.log('Tour step callback error', { error: String(e) });
        }
      }

      // Schedule auto-advance if in auto mode
      if (this.tourMode === 'auto') {
        this.scheduleAutoAdvance();
      }
    }, 100);
  }

  /**
   * Schedule auto-advance to the next tour step.
   */
  private scheduleAutoAdvance(): void {
    this.clearAutoTimer();

    if (this.tourMode !== 'auto') return;
    if (this.tourPausedByInteraction) return;

    this.tourAutoTimer = setTimeout(() => {
      if (!this.destroyed && !this.tourPausedByInteraction) {
        this.nextTourStep();
      }
    }, AUTO_TOUR_INTERVAL_MS);
  }

  /**
   * Clear the auto-advance timer.
   */
  private clearAutoTimer(): void {
    if (this.tourAutoTimer !== null) {
      clearTimeout(this.tourAutoTimer);
      this.tourAutoTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Private: Accessibility — aria-live announcements
  // -------------------------------------------------------------------------

  /**
   * Announce a message to screen readers via an aria-live region.
   */
  private announce(message: string): void {
    if (typeof document === 'undefined') return;

    if (!this.liveRegionEl) {
      const region = document.createElement('div');
      region.setAttribute('aria-live', 'assertive');
      region.setAttribute('aria-atomic', 'true');
      region.setAttribute('data-guidekit-live', 'true');
      region.style.cssText = [
        'position: absolute',
        'width: 1px',
        'height: 1px',
        'padding: 0',
        'margin: -1px',
        'overflow: hidden',
        'clip: rect(0, 0, 0, 0)',
        'white-space: nowrap',
        'border: 0',
      ].join('; ');
      document.body.appendChild(region);
      this.liveRegionEl = region;
    }

    // Clear and re-set to trigger announcement
    this.liveRegionEl.textContent = '';
    // Use a microtask to ensure the DOM update is flushed before re-setting
    requestAnimationFrame(() => {
      if (this.liveRegionEl) {
        this.liveRegionEl.textContent = message;
      }
    });
  }

  // -------------------------------------------------------------------------
  // Private: Subscriber notifications
  // -------------------------------------------------------------------------

  private notifySpotlightChange(): void {
    const stateCopy = this.state;
    for (const cb of this.spotlightChangeCallbacks) {
      try {
        cb(stateCopy);
      } catch (e) {
        this.log('Spotlight change callback error', { error: String(e) });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private: Utilities
  // -------------------------------------------------------------------------

  /**
   * Get the transition duration, respecting prefers-reduced-motion.
   */
  private getTransitionDuration(): number {
    return prefersReducedMotion() ? 0 : this.animationDuration;
  }

  /**
   * Debug logger.
   */
  private log(message: string, data?: Record<string, unknown>): void {
    if (!this.debug) return;
    if (typeof console !== 'undefined') {
      if (data) {
        console.log(`${LOG_PREFIX} ${message}`, data);
      } else {
        console.log(`${LOG_PREFIX} ${message}`);
      }
    }
  }
}
