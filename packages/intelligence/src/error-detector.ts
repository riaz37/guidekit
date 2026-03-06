/**
 * @module ErrorDetector
 *
 * Detects error states on a page using ARIA-first strategies,
 * class-name patterns, text-content heuristics, and toast/banner patterns.
 *
 * Performance: uses targeted CSS selectors — never walks all DOM nodes
 * or calls getComputedStyle on querySelectorAll('*').
 */

import type { PageErrorState } from '@guidekit/core';

// ---------------------------------------------------------------------------
// Types & Constants
// ---------------------------------------------------------------------------

type ErrorType = PageErrorState['type'];
type Severity = PageErrorState['severity'];

/** Selector for ARIA-based error candidates. */
const ARIA_SELECTOR = [
  '[aria-invalid="true"]',
  '[role="alert"]',
  '[aria-errormessage]',
].join(',');

/** Class-name patterns indicating errors. */
const ERROR_CLASS_PATTERNS = [
  '.error',
  '.invalid',
  '.danger',
  '.alert-error',
  '.field-error',
  '.has-error',
  '.is-invalid',
  '.form-error',
];

/** Toast / notification patterns. */
const TOAST_SELECTOR = [
  '.toast-error',
  '.notification-error',
  '[data-type="error"]',
].join(',');

/** Banner patterns. */
const BANNER_SELECTOR = [
  '.alert-banner',
  '.error-banner',
].join(',');

/** Warning-class patterns (lower severity). */
const WARNING_CLASS_PATTERNS = [
  '.warning',
  '.alert-warning',
  '.caution',
];

/** Info-class patterns (lowest severity). */
const INFO_CLASS_PATTERNS = [
  '.info',
  '.alert-info',
  '.notice',
];

/** Text patterns hinting at errors (case-insensitive). */
const ERROR_TEXT_PATTERNS: RegExp[] = [
  /\berror\s*:/i,
  /\bfailed to\b/i,
  /\binvalid\b/i,
  /\bcould not\b/i,
  /\bnot found\b/i,
  /\baccess denied\b/i,
  /\bpermission denied\b/i,
  /\bunauthorized\b/i,
  /\bforbidden\b/i,
];

/** Close-button selectors used to determine dismissibility. */
const CLOSE_BUTTON_SELECTOR = [
  'button[aria-label="Close"]',
  'button[aria-label="close"]',
  'button[aria-label="Dismiss"]',
  'button[aria-label="dismiss"]',
  'button.close',
  'button.btn-close',
  '[data-dismiss]',
  '[data-action="close"]',
].join(',');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a unique CSS selector for a given element (best-effort).
 * Prefers id, then a combined tag + class string, then nth-child.
 */
function buildSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList)
    .map((c) => `.${CSS.escape(c)}`)
    .join('');

  if (classes) {
    const candidate = `${tag}${classes}`;
    try {
      const root = el.getRootNode() as Document | ShadowRoot;
      if (
        'querySelectorAll' in root &&
        root.querySelectorAll(candidate).length === 1
      ) {
        return candidate;
      }
    } catch {
      // fall through
    }
  }

  // Fallback: tag + nth-child
  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children);
    const idx = siblings.indexOf(el) + 1;
    return `${buildSelector(parent)} > ${tag}:nth-child(${idx})`;
  }

  return tag;
}

/** Extract visible text content from an element (first 200 chars). */
function extractMessage(el: Element): string {
  const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
  return text.slice(0, 200);
}

/** Check whether the element (or an ancestor up to 3 levels) contains a close button. */
function isDismissible(el: Element): boolean {
  // Check within the element itself
  if (el.querySelector(CLOSE_BUTTON_SELECTOR)) return true;

  // Also check up to 3 ancestor levels (for wrapper patterns)
  let current: Element | null = el;
  for (let i = 0; i < 3 && current; i++) {
    current = current.parentElement;
    if (current?.querySelector(CLOSE_BUTTON_SELECTOR)) return true;
  }

  return false;
}

/** Determine severity from classes on the element. */
function classifySeverity(el: Element): Severity {
  const cls = el.className;
  if (typeof cls !== 'string') return 'error';

  for (const pat of WARNING_CLASS_PATTERNS) {
    if (el.matches(pat)) return 'warning';
  }
  for (const pat of INFO_CLASS_PATTERNS) {
    if (el.matches(pat)) return 'info';
  }

  // ARIA: aria-invalid is always severity "error"
  if (el.getAttribute('aria-invalid') === 'true') return 'error';

  return 'error';
}

/** Try to find the related form field for an error element. */
function findRelatedField(el: Element, root: Element): string | undefined {
  // 1. If el has aria-errormessage pointing to itself from a field
  //    Actually aria-errormessage is on the field pointing to the error message.
  //    So if `el` IS the error message, find who references it.
  if (el.id) {
    const referrer = root.querySelector(
      `[aria-errormessage="${CSS.escape(el.id)}"]`
    );
    if (referrer) return buildSelector(referrer);

    // Also check aria-describedby references
    const describedBy = root.querySelector(
      `[aria-describedby~="${CSS.escape(el.id)}"]`
    );
    if (describedBy) return buildSelector(describedBy);
  }

  // 2. If el itself is an invalid field
  if (el.getAttribute('aria-invalid') === 'true') {
    return undefined; // The element IS the field; selector already captured.
  }

  // 3. Walk up looking for a form-group wrapper containing an input
  let current: Element | null = el.parentElement;
  for (let depth = 0; depth < 4 && current && current !== root; depth++) {
    const field = current.querySelector(
      'input, select, textarea, [contenteditable="true"]'
    );
    if (field) return buildSelector(field);
    current = current.parentElement;
  }

  return undefined;
}

/** Classify the error type from element semantics. */
function classifyType(el: Element, message: string): ErrorType {
  // aria-invalid fields → form-validation
  if (el.getAttribute('aria-invalid') === 'true') return 'form-validation';

  // Toast / notification
  if (el.matches(TOAST_SELECTOR)) return 'toast-error';

  // Banner
  if (el.matches(BANNER_SELECTOR)) return 'banner-error';

  // Class-based form errors
  if (el.matches('.field-error, .form-error, .has-error, .is-invalid')) {
    return 'form-validation';
  }

  // Text-based classification
  const lowerMsg = message.toLowerCase();
  if (/\bnot found\b|404/.test(lowerMsg)) return 'not-found';
  if (/\bpermission|unauthorized|forbidden|access denied\b/.test(lowerMsg)) {
    return 'permission';
  }
  if (/\bfailed to|api |server |request |fetch\b/.test(lowerMsg)) {
    return 'api-error';
  }

  // role="alert" with error classes → could be anything; check for inline
  if (el.matches('[role="alert"]')) {
    // If inside a form or near a field, treat as inline
    if (el.closest('form') || findRelatedField(el, el.ownerDocument.documentElement)) {
      return 'inline-error';
    }
    return 'api-error';
  }

  // Inline errors by class
  if (el.matches('.error, .invalid, .danger, .alert-error')) {
    return 'inline-error';
  }

  return 'inline-error';
}

// ---------------------------------------------------------------------------
// ErrorDetector
// ---------------------------------------------------------------------------

export class ErrorDetector {
  /**
   * Detect error states within the given root element.
   *
   * Uses targeted CSS selectors (ARIA attributes, known class patterns,
   * toast/banner selectors) to avoid full DOM traversal.
   */
  detect(root: Element): PageErrorState[] {
    const seen = new Set<Element>();
    const results: PageErrorState[] = [];

    const process = (el: Element): void => {
      if (seen.has(el)) return;
      seen.add(el);

      const message = extractMessage(el);
      if (!message) return; // Skip empty error containers

      const type = classifyType(el, message);
      const severity = classifySeverity(el);
      const selector = buildSelector(el);
      const dismissible = isDismissible(el);
      const relatedField = findRelatedField(el, root);

      const state: PageErrorState = {
        type,
        message,
        selector,
        severity,
        dismissible,
      };

      if (relatedField) {
        state.relatedField = relatedField;
      }

      results.push(state);
    };

    // --- Strategy 1: ARIA-based detection ---
    const ariaElements = root.querySelectorAll(ARIA_SELECTOR);
    ariaElements.forEach(process);

    // For aria-errormessage: the attribute is on the field, pointing to the
    // error message element. We need to find the referenced element.
    const fieldsWithErrorMsg = root.querySelectorAll('[aria-errormessage]');
    fieldsWithErrorMsg.forEach((field) => {
      const errorId = field.getAttribute('aria-errormessage');
      if (!errorId) return;
      const errorEl = root.querySelector(`#${CSS.escape(errorId)}`);
      if (errorEl) process(errorEl);
    });

    // --- Strategy 2: Class-name pattern matching ---
    const classSelector = ERROR_CLASS_PATTERNS.join(',');
    const classElements = root.querySelectorAll(classSelector);
    classElements.forEach((el) => {
      // Only process if the element itself looks like an error message
      // (not a wrapper that merely has an error class for styling)
      const text = (el.textContent ?? '').trim();
      if (text) process(el);
    });

    // --- Strategy 3: Toast / notification patterns ---
    const toastElements = root.querySelectorAll(TOAST_SELECTOR);
    toastElements.forEach(process);

    // --- Strategy 4: Banner patterns ---
    const bannerElements = root.querySelectorAll(BANNER_SELECTOR);
    bannerElements.forEach(process);

    // --- Strategy 5: Text-content heuristic on role="alert" already
    //     handled above. For broader text scanning, check known container
    //     patterns that might not have error classes. ---
    const statusElements = root.querySelectorAll(
      '[role="status"], [role="log"], [aria-live="polite"], [aria-live="assertive"]'
    );
    statusElements.forEach((el) => {
      const text = (el.textContent ?? '').trim();
      if (!text) return;
      const matchesError = ERROR_TEXT_PATTERNS.some((pat) => pat.test(text));
      if (matchesError) process(el);
    });

    return results;
  }
}
