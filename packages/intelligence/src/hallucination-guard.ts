/**
 * @module hallucination-guard
 *
 * Validates LLM response claims against actual page state to prevent
 * the assistant from referencing UI elements or navigation targets
 * that do not exist on the current page.
 */

import type {
  PageModel,
  HallucinationResult,
  HallucinationIssue,
} from '@guidekit/core';

// ---------------------------------------------------------------------------
// Severity weights for confidence scoring
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHTS: Record<HallucinationIssue['severity'], number> = {
  high: 0.3,
  medium: 0.15,
  low: 0.05,
};

// ---------------------------------------------------------------------------
// Regex patterns for extracting element references from LLM text
// ---------------------------------------------------------------------------

/** Patterns that extract element references like "click the Submit button". */
const ELEMENT_REFERENCE_PATTERNS: RegExp[] = [
  /click\s+(?:the\s+|on\s+)?"([^"]+)"/gi,
  /click\s+(?:the\s+|on\s+)?['"]([^'"]+)['"]/gi,
  /click\s+(?:the\s+|on\s+)?(\S+)\s+(?:button|link|tab|icon)/gi,
  /select\s+(?:the\s+)?['"]([^'"]+)['"]/gi,
  /select\s+(?:the\s+)?(\S+)\s+(?:button|link|tab|dropdown|option|checkbox|radio)/gi,
  /(?:enter|type|input|fill\s+in)\s+(?:text\s+)?(?:in(?:to)?\s+)?(?:the\s+)?['"]([^'"]+)['"]\s+(?:field|input|textarea|box)/gi,
  /(?:enter|type|input|fill\s+in)\s+(?:text\s+)?(?:in(?:to)?\s+)?(?:the\s+)?(\S+)\s+(?:field|input|textarea|box)/gi,
  /(?:toggle|check|uncheck)\s+(?:the\s+)?['"]([^'"]+)['"]/gi,
  /(?:toggle|check|uncheck)\s+(?:the\s+)?(\S+)\s+(?:checkbox|switch|toggle)/gi,
  /(?:open|expand|collapse)\s+(?:the\s+)?['"]([^'"]+)['"]\s+(?:dropdown|menu|accordion|section)/gi,
  /(?:press|tap|hit)\s+(?:the\s+)?['"]([^'"]+)['"]\s*(?:button)?/gi,
];

/** Patterns that extract navigation references like "go to Settings page". */
const NAVIGATION_REFERENCE_PATTERNS: RegExp[] = [
  /go\s+to\s+(?:the\s+)?['"]([^'"]+)['"]/gi,
  /go\s+to\s+(?:the\s+)?(\S+?)(?:\s+page|\s+section|\s+tab|\s+screen|[.,;!?]|$)/gi,
  /navigate\s+to\s+(?:the\s+)?['"]([^'"]+)['"]/gi,
  /navigate\s+to\s+(?:the\s+)?(\S+?)(?:\s+page|\s+section|\s+tab|\s+screen|[.,;!?]|$)/gi,
  /visit\s+(?:the\s+)?['"]([^'"]+)['"]\s*(?:page)?/gi,
  /visit\s+(?:the\s+)?(\S+)\s+page/gi,
  /head\s+(?:over\s+)?to\s+(?:the\s+)?['"]([^'"]+)['"]/gi,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a label for fuzzy comparison: lowercase, trim, collapse whitespace.
 */
function normalise(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Check whether `candidate` fuzzy-matches any entry in `labels`.
 * Uses case-insensitive substring matching in both directions so that
 * "Submit" matches "Submit Form" and vice versa.
 */
function fuzzyMatchLabel(candidate: string, labels: string[]): string | null {
  const norm = normalise(candidate);
  if (norm.length === 0) return null;

  for (const label of labels) {
    const normLabel = normalise(label);
    if (normLabel.length === 0) continue;
    if (normLabel === norm) return label;
    if (normLabel.includes(norm) || norm.includes(normLabel)) return label;
  }
  return null;
}

/**
 * Extract all unique captured group values from a text using a list of patterns.
 */
function extractReferences(text: string, patterns: RegExp[]): string[] {
  const refs = new Set<string>();

  for (const pattern of patterns) {
    // Reset lastIndex for global regexes
    const re = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      // Take the first captured group that is non-empty
      for (let i = 1; i < match.length; i++) {
        const group = match[i];
        if (group && group.trim().length > 0) {
          refs.add(group.trim());
          break;
        }
      }
    }
  }

  return Array.from(refs);
}

/**
 * Build a human-readable list of available labels, capped to avoid huge messages.
 */
function formatAvailable(labels: string[], max = 8): string {
  if (labels.length === 0) return 'none found on page';
  const display = labels.slice(0, max);
  const suffix = labels.length > max ? `, ... (${labels.length - max} more)` : '';
  return display.join(', ') + suffix;
}

// ---------------------------------------------------------------------------
// HallucinationGuard
// ---------------------------------------------------------------------------

/**
 * Validates LLM response text against the current page model to catch
 * references to non-existent elements or navigation targets.
 *
 * @example
 * ```ts
 * const guard = new HallucinationGuard();
 * const result = guard.validate(llmResponse, pageModel);
 * if (!result.isValid) {
 *   console.warn('Hallucination detected:', result.issues);
 * }
 * ```
 */
export class HallucinationGuard {
  /**
   * Validate an LLM response string against the provided page model.
   *
   * @param response - The raw text response from the LLM.
   * @param pageModel - Current page snapshot with interactive elements and navigation.
   * @returns Validation result with issues, validity flag, and confidence score.
   */
  validate(response: string, pageModel: PageModel): HallucinationResult {
    const issues: HallucinationIssue[] = [];

    // --- Element-reference validation ---
    const elementLabels = pageModel.interactiveElements
      .map((el) => el.label)
      .filter((l) => l.length > 0);

    const elementRefs = extractReferences(response, ELEMENT_REFERENCE_PATTERNS);

    for (const ref of elementRefs) {
      const matched = fuzzyMatchLabel(ref, elementLabels);
      if (!matched) {
        issues.push({
          type: 'element-reference',
          claim: ref,
          severity: 'high',
          suggestion: `Element '${ref}' not found. Available interactive elements: ${formatAvailable(elementLabels)}`,
        });
      }
    }

    // --- Navigation-reference validation ---
    const navLabels = pageModel.navigation.map((n) => n.label).filter((l) => l.length > 0);

    const navRefs = extractReferences(response, NAVIGATION_REFERENCE_PATTERNS);

    for (const ref of navRefs) {
      // Check both navigation labels and interactive element labels (nav items
      // may also appear as interactive elements on some pages).
      const matchedNav = fuzzyMatchLabel(ref, navLabels);
      const matchedElement = fuzzyMatchLabel(ref, elementLabels);
      if (!matchedNav && !matchedElement) {
        issues.push({
          type: 'navigation-reference',
          claim: ref,
          severity: 'medium',
          suggestion: `Navigation target '${ref}' not found. Available navigation: ${formatAvailable(navLabels)}`,
        });
      }
    }

    // --- Compute confidence ---
    const totalWeight = issues.reduce(
      (sum, issue) => sum + SEVERITY_WEIGHTS[issue.severity],
      0,
    );
    const confidence = Math.max(0, 1.0 - totalWeight);

    // --- Determine validity: valid if no high-severity issues ---
    const isValid = !issues.some((issue) => issue.severity === 'high');

    return { isValid, confidence, issues };
  }
}
