/**
 * @module @guidekit/core/dom/element-resolver
 *
 * Resolve semantic references (sectionId, label) to stable CSS selectors.
 */

import type { PageModel } from '../types/index.js';

export interface ElementResolveRequest {
  sectionId?: string;
  selector?: string;
  label?: string;
}

export interface ElementResolveResult {
  selector: string;
  confidence: number;
  reason: string;
}

const DANGEROUS_LABEL_RE =
  /\b(delete|remove|logout|log out|sign out|cancel subscription|pay now|checkout|submit order|confirm payment)\b/i;

const DANGEROUS_SELECTOR_RE =
  /(\[type=["']submit["']\]|button\[formaction\]|form\b|data-guidekit-no-click)/i;

function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

function fuzzyMatchLabel(candidate: string, labels: string[]): string | null {
  const norm = normalize(candidate);
  if (!norm) return null;

  for (const label of labels) {
    const normLabel = normalize(label);
    if (!normLabel) continue;
    if (normLabel === norm) return label;
    if (normLabel.includes(norm) || norm.includes(normLabel)) return label;
  }
  return null;
}

export function resolveSectionSelector(
  model: PageModel,
  sectionId: string,
): ElementResolveResult | null {
  const section = model.sections.find(
    (s) => s.id === sectionId || normalize(s.label) === normalize(sectionId),
  );
  if (!section) return null;

  return {
    selector: section.selector,
    confidence: section.id === sectionId ? 0.9 : 0.8,
    reason: `section:${section.id}`,
  };
}

export function resolveInteractiveByLabel(
  model: PageModel,
  label: string,
): ElementResolveResult | null {
  const labels = model.interactiveElements.map((el) => el.label);
  const matched = fuzzyMatchLabel(label, labels);
  if (!matched) return null;

  const el = model.interactiveElements.find((e) => e.label === matched);
  if (!el) return null;

  return {
    selector: el.selector,
    confidence: el.guideKitTarget ? 0.95 : 0.75,
    reason: `interactive:${matched}`,
  };
}

export function resolveElement(
  model: PageModel,
  request: ElementResolveRequest,
): ElementResolveResult | null {
  if (request.selector) {
    return {
      selector: request.selector,
      confidence: 1,
      reason: 'explicit-selector',
    };
  }

  if (request.sectionId) {
    return resolveSectionSelector(model, request.sectionId);
  }

  if (request.label) {
    const bySection = resolveSectionSelector(model, request.label);
    if (bySection) return bySection;
    return resolveInteractiveByLabel(model, request.label);
  }

  return null;
}

export interface DangerousClickAssessment {
  blocked: boolean;
  reason?: string;
}

export function assessDangerousClick(
  selector: string,
  element: Element | null,
): DangerousClickAssessment {
  if (DANGEROUS_SELECTOR_RE.test(selector)) {
    return {
      blocked: true,
      reason: 'Selector matches a dangerous pattern (submit/form).',
    };
  }

  if (!element) return { blocked: false };

  const text = [
    element.getAttribute('aria-label') ?? '',
    element.textContent ?? '',
    element.getAttribute('title') ?? '',
  ].join(' ');

  if (DANGEROUS_LABEL_RE.test(text)) {
    return {
      blocked: true,
      reason: 'Element label suggests a destructive or payment action.',
    };
  }

  return { blocked: false };
}
