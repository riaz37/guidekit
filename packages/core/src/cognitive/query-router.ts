/**
 * @module @guidekit/core/cognitive/query-router
 *
 * Heuristic complexity classification — no extra LLM call.
 */

export type QueryComplexity = 'simple' | 'moderate' | 'complex';

const COMPLEX_PATTERNS = [
  /\bstep(?:s)?\s+(?:by\s+)?step\b/i,
  /\bwalk\s+me\s+through\b/i,
  /\bhow\s+do\s+i\s+(?:complete|finish|submit)\b/i,
  /\bmultiple\b/i,
  /\bcheckout\b/i,
  /\bonboarding\b/i,
  /\btutorial\b/i,
  /\bguide\s+me\b/i,
];

const SIMPLE_PATTERNS = [
  /\bhighlight\b/i,
  /\bwhere\s+is\b/i,
  /\bclick\b/i,
  /\bscroll\b/i,
  /\bwhat\s+is\s+this\b/i,
  /\bshow\s+me\b/i,
];

export class QueryRouter {
  classify(message: string): QueryComplexity {
    const trimmed = message.trim();
    if (trimmed.length < 20 && SIMPLE_PATTERNS.some((p) => p.test(trimmed))) {
      return 'simple';
    }
    if (COMPLEX_PATTERNS.some((p) => p.test(trimmed)) || trimmed.length > 180) {
      return 'complex';
    }
    if (trimmed.split(/\?/).length > 2 || trimmed.includes(' and ')) {
      return 'moderate';
    }
    return 'simple';
  }
}
