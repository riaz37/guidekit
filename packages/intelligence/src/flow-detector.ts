/**
 * @module FlowDetector
 *
 * Detects multi-step flows and wizards on a page by analyzing DOM structure,
 * ARIA attributes, text patterns, CSS classes, and developer annotations.
 */

import type { FlowState } from '@guidekit/core';

/** Keywords mapped to flow types for classification. */
const FLOW_TYPE_KEYWORDS: Record<FlowState['type'], string[]> = {
  checkout: ['checkout', 'payment', 'cart', 'billing', 'shipping'],
  signup: ['sign up', 'signup', 'register', 'create account', 'registration'],
  onboarding: ['welcome', 'get started', 'tutorial', 'getting started', 'setup', 'set up'],
  survey: ['survey', 'questionnaire', 'feedback', 'poll'],
  wizard: [],
  custom: [],
};

/** CSS selectors for common step container elements. */
const STEP_SELECTORS = [
  '.step',
  '.wizard-step',
  '[data-step]',
  '.stepper',
  '.progress-step',
  '.stepper-item',
  '.wizard-item',
  '.step-item',
];

/** Text patterns that indicate "Step X of Y" or "Page X/Y" style indicators. */
const TEXT_STEP_PATTERNS: RegExp[] = [
  /step\s+(\d+)\s+of\s+(\d+)/i,
  /page\s+(\d+)\s*\/\s*(\d+)/i,
  /(\d+)\s*\/\s*(\d+)/,
  /step\s+(\d+)\s*\/\s*(\d+)/i,
  /(\d+)\s+of\s+(\d+)/i,
];

/**
 * Builds a unique CSS selector for a given element, used for `progressSelector`.
 */
function buildSelector(el: Element): string {
  if (el.id) {
    return `#${el.id}`;
  }

  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList).join('.');
  const parent = el.parentElement;

  let selector = classes ? `${tag}.${classes}` : tag;

  if (parent) {
    const siblings = Array.from(parent.children).filter(
      (child) => child.tagName === el.tagName,
    );
    if (siblings.length > 1) {
      const idx = siblings.indexOf(el) + 1;
      selector += `:nth-of-type(${idx})`;
    }
  }

  return selector;
}

/**
 * Determines the flow type based on textual content found in the root element.
 */
function classifyFlowType(
  root: Element,
  isAnnotated: boolean,
): FlowState['type'] {
  if (isAnnotated) {
    return 'custom';
  }

  const text = (root.textContent ?? '').toLowerCase();

  for (const [type, keywords] of Object.entries(FLOW_TYPE_KEYWORDS) as Array<
    [FlowState['type'], string[]]
  >) {
    if (keywords.length === 0) continue;
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        return type;
      }
    }
  }

  return 'wizard';
}

/**
 * Extracts the trimmed text label from an element, preferring `aria-label`.
 */
function extractLabel(el: Element): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();
  return (el.textContent ?? '').trim().slice(0, 80);
}

/**
 * Determines whether a step element is the "current/active" step.
 */
function isActiveStep(el: Element): boolean {
  if (el.classList.contains('active') || el.classList.contains('current')) {
    return true;
  }
  if (el.getAttribute('aria-current') === 'step') {
    return true;
  }
  // Also accept generic aria-current="true"
  if (el.getAttribute('aria-current') === 'true') {
    return true;
  }
  return false;
}

/**
 * Determines whether a step element is "completed".
 */
function isCompletedStep(el: Element): boolean {
  if (
    el.classList.contains('completed') ||
    el.classList.contains('done') ||
    el.classList.contains('complete') ||
    el.classList.contains('finished')
  ) {
    return true;
  }
  if (el.getAttribute('aria-checked') === 'true') {
    return true;
  }
  // Check for checkmark icons (common SVG or icon-font patterns)
  const hasCheckIcon = el.querySelector(
    '.check, .checkmark, .done-icon, [data-icon="check"], svg.check',
  );
  if (hasCheckIcon) {
    return true;
  }
  return false;
}

/**
 * FlowDetector analyses a DOM subtree for multi-step flow / wizard patterns
 * and returns structured `FlowState` data when a flow is detected.
 */
export class FlowDetector {
  /**
   * Detect a multi-step flow within the given root element.
   *
   * @param root - The DOM element to scan (typically `document.body` or a container).
   * @returns A `FlowState` object if a flow is detected, or `null` otherwise.
   */
  detect(root: Element): FlowState | null {
    // Strategy 1: Developer annotation (highest priority)
    const annotated = this.detectAnnotation(root);
    if (annotated) return annotated;

    // Strategy 2: ARIA progressbar
    const progressbar = this.detectProgressbar(root);
    if (progressbar) return progressbar;

    // Strategy 3: Step elements by CSS class / data attribute
    const stepElements = this.detectStepElements(root);
    if (stepElements) return stepElements;

    // Strategy 4: Ordered lists in nav/header context
    const orderedList = this.detectOrderedList(root);
    if (orderedList) return orderedList;

    // Strategy 5: Text patterns ("Step X of Y")
    const textPattern = this.detectTextPattern(root);
    if (textPattern) return textPattern;

    return null;
  }

  /**
   * Strategy: `data-guidekit-flow` annotation.
   * Developers can annotate a container with structured flow metadata.
   */
  private detectAnnotation(root: Element): FlowState | null {
    const annotated = root.querySelector('[data-guidekit-flow]');
    if (!annotated) {
      // Check if root itself has the annotation
      if (!root.hasAttribute('data-guidekit-flow')) return null;
      return this.parseAnnotation(root);
    }
    return this.parseAnnotation(annotated);
  }

  private parseAnnotation(el: Element): FlowState | null {
    const raw = el.getAttribute('data-guidekit-flow');
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as Partial<FlowState>;
      const currentStep = parsed.currentStep ?? 1;
      const totalSteps = parsed.totalSteps ?? 1;

      return {
        type: parsed.type ?? 'custom',
        currentStep,
        totalSteps,
        stepLabels: parsed.stepLabels ?? [],
        completedSteps: parsed.completedSteps ?? [],
        progressSelector: buildSelector(el),
      };
    } catch {
      // If not JSON, treat the value as the flow type
      return {
        type: 'custom',
        currentStep: 1,
        totalSteps: 1,
        stepLabels: [],
        completedSteps: [],
        progressSelector: buildSelector(el),
      };
    }
  }

  /**
   * Strategy: `role="progressbar"` with aria-valuenow / aria-valuemax.
   */
  private detectProgressbar(root: Element): FlowState | null {
    const bar = root.querySelector('[role="progressbar"]');
    if (!bar) return null;

    const valueNow = parseFloat(bar.getAttribute('aria-valuenow') ?? '');
    const valueMax = parseFloat(bar.getAttribute('aria-valuemax') ?? '');

    if (isNaN(valueNow) || isNaN(valueMax) || valueMax <= 0) return null;

    // Determine if values represent step counts (small integers) or percentages
    let currentStep: number;
    let totalSteps: number;

    if (valueMax <= 20 && Number.isInteger(valueMax)) {
      // Likely step-based (e.g., 2/5)
      currentStep = Math.round(valueNow);
      totalSteps = Math.round(valueMax);
    } else {
      // Likely percentage-based — try to find step elements nearby for count
      const stepInfo = this.findNearbySteps(root, bar);
      if (stepInfo) {
        currentStep = stepInfo.currentStep;
        totalSteps = stepInfo.totalSteps;
      } else {
        // Fall back: treat percentage as a rough step indicator
        // e.g., 50% of 100 with no other info — not enough to detect steps
        return null;
      }
    }

    if (currentStep < 1 || totalSteps < 2) return null;

    const isAnnotated = false;
    return {
      type: classifyFlowType(root, isAnnotated),
      currentStep,
      totalSteps,
      stepLabels: [],
      completedSteps: this.inferCompletedFromCurrent(currentStep),
      progressSelector: buildSelector(bar),
    };
  }

  /**
   * Look for step-like elements near a progressbar to refine step counts.
   */
  private findNearbySteps(
    root: Element,
    _bar: Element,
  ): { currentStep: number; totalSteps: number } | null {
    for (const selector of STEP_SELECTORS) {
      const steps = root.querySelectorAll(selector);
      if (steps.length >= 2) {
        let current = 1;
        steps.forEach((step, i) => {
          if (isActiveStep(step)) current = i + 1;
        });
        return { currentStep: current, totalSteps: steps.length };
      }
    }
    return null;
  }

  /**
   * Strategy: Step elements identified by common CSS classes / data attributes.
   */
  private detectStepElements(root: Element): FlowState | null {
    for (const selector of STEP_SELECTORS) {
      const steps = root.querySelectorAll(selector);
      if (steps.length < 2) continue;

      const totalSteps = steps.length;
      let currentStep = 1;
      const stepLabels: string[] = [];
      const completedSteps: number[] = [];

      steps.forEach((step, i) => {
        const idx = i + 1;

        if (isActiveStep(step)) {
          currentStep = idx;
        }

        if (isCompletedStep(step)) {
          completedSteps.push(idx);
        }

        const label = extractLabel(step);
        if (label) {
          stepLabels.push(label);
        }
      });

      const isAnnotated = false;
      const firstStep = steps[0] as Element;
      const container = firstStep.parentElement;

      return {
        type: classifyFlowType(root, isAnnotated),
        currentStep,
        totalSteps,
        stepLabels,
        completedSteps,
        progressSelector: container ? buildSelector(container) : buildSelector(firstStep),
      };
    }

    return null;
  }

  /**
   * Strategy: Ordered lists (`<ol>`) inside `<nav>` or `<header>` with active step markers.
   */
  private detectOrderedList(root: Element): FlowState | null {
    // Look for <ol> inside nav or header
    const navHeaders = root.querySelectorAll('nav, header, [role="navigation"]');
    for (const container of Array.from(navHeaders)) {
      const ol = container.querySelector('ol');
      if (!ol) continue;

      const items = ol.querySelectorAll('li');
      if (items.length < 2) continue;

      let currentStep = 1;
      let foundActive = false;
      const stepLabels: string[] = [];
      const completedSteps: number[] = [];

      items.forEach((li, i) => {
        const idx = i + 1;

        if (isActiveStep(li)) {
          currentStep = idx;
          foundActive = true;
        }

        if (isCompletedStep(li)) {
          completedSteps.push(idx);
        }

        const label = extractLabel(li);
        if (label) {
          stepLabels.push(label);
        }
      });

      // Only return if we found an active marker — otherwise it is just a regular list
      if (!foundActive) continue;

      const isAnnotated = false;
      return {
        type: classifyFlowType(root, isAnnotated),
        currentStep,
        totalSteps: items.length,
        stepLabels,
        completedSteps,
        progressSelector: buildSelector(ol),
      };
    }

    return null;
  }

  /**
   * Strategy: Text patterns like "Step 2 of 5", "Page 3/4", "2/5" in the DOM.
   */
  private detectTextPattern(root: Element): FlowState | null {
    // Walk common indicator elements first, then fall back to full text
    const candidates = root.querySelectorAll(
      '.progress, .step-indicator, .step-counter, .pagination, ' +
      '[class*="progress"], [class*="step"], [class*="wizard"], ' +
      'span, p, div, h1, h2, h3, h4, h5, h6',
    );

    for (const el of Array.from(candidates)) {
      const text = el.textContent ?? '';
      if (text.length > 200) continue; // Skip large containers to avoid false matches

      for (const pattern of TEXT_STEP_PATTERNS) {
        const match = text.match(pattern);
        if (!match) continue;

        const current = parseInt(match[1] ?? '0', 10);
        const total = parseInt(match[2] ?? '0', 10);

        if (current < 1 || total < 2 || current > total) continue;

        const isAnnotated = false;
        return {
          type: classifyFlowType(root, isAnnotated),
          currentStep: current,
          totalSteps: total,
          stepLabels: [],
          completedSteps: this.inferCompletedFromCurrent(current),
          progressSelector: buildSelector(el),
        };
      }
    }

    return null;
  }

  /**
   * Infer completed steps as all steps before the current one.
   * Used when explicit completion markers are not available.
   */
  private inferCompletedFromCurrent(currentStep: number): number[] {
    const completed: number[] = [];
    for (let i = 1; i < currentStep; i++) {
      completed.push(i);
    }
    return completed;
  }
}
