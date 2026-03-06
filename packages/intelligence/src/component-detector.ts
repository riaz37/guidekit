/**
 * @module ComponentDetector
 *
 * Detects UI component patterns on a page using a layered strategy:
 *   1. Developer-annotated `data-guidekit-component` attributes (highest priority)
 *   2. ARIA role patterns (tablist+tab, dialog, menu)
 *   3. CSS class pattern matching (card, modal, accordion, etc.)
 *   4. Structural heuristics (repeated sibling elements)
 *
 * Performance: Uses targeted querySelectorAll selectors — never walks all DOM elements.
 */

import type { ComponentNode } from '@guidekit/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ComponentType = ComponentNode['type'];

interface CandidateMatch {
  element: Element;
  type: ComponentType;
  confidence: number;
  source: 'annotated' | 'aria' | 'class' | 'structural';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** CSS class substring → component type mapping with confidence. */
const CLASS_PATTERNS: Array<{ pattern: RegExp; type: ComponentType; confidence: number }> = [
  { pattern: /\bmodal\b/i, type: 'modal', confidence: 0.7 },
  { pattern: /\bdialog\b/i, type: 'modal', confidence: 0.65 },
  { pattern: /\btab(?:s|list|-group|panel|container)\b/i, type: 'tab-group', confidence: 0.7 },
  { pattern: /\baccordion\b/i, type: 'accordion', confidence: 0.75 },
  { pattern: /\bcollaps(?:e|ible)\b/i, type: 'accordion', confidence: 0.6 },
  { pattern: /\bcard\b/i, type: 'card', confidence: 0.6 },
  { pattern: /\bwizard\b/i, type: 'form-wizard', confidence: 0.75 },
  { pattern: /\bstepper\b/i, type: 'form-wizard', confidence: 0.7 },
  { pattern: /\bdata-?table\b/i, type: 'data-table', confidence: 0.75 },
  { pattern: /\bbreadcrumb\b/i, type: 'breadcrumb', confidence: 0.8 },
  { pattern: /\bsearch(?:-?bar|-?box|-?form)?\b/i, type: 'search', confidence: 0.65 },
  { pattern: /\bdropdown\b/i, type: 'dropdown', confidence: 0.7 },
  { pattern: /\bpopover\b/i, type: 'dropdown', confidence: 0.6 },
];

/** Class-based selectors — broad but still targeted. */
const CLASS_CANDIDATE_SELECTORS = [
  '[class*="modal"]',
  '[class*="dialog"]',
  '[class*="tab"]',
  '[class*="accordion"]',
  '[class*="collaps"]',
  '[class*="card"]',
  '[class*="wizard"]',
  '[class*="stepper"]',
  '[class*="table"]',
  '[class*="breadcrumb"]',
  '[class*="search"]',
  '[class*="dropdown"]',
  '[class*="popover"]',
].join(',');

/** Interactive element selectors for discovering child controls. */
const INTERACTIVE_SELECTOR =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="tab"], [contenteditable="true"]';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate the most specific CSS selector for an element.
 * Priority: id > data-guidekit-component > data-testid > nth-child chain.
 */
function generateSelector(el: Element): string {
  // ID selector (most specific)
  if (el.id) {
    return `#${CSS.escape(el.id)}`;
  }

  // data-guidekit-component
  const gkAttr = el.getAttribute('data-guidekit-component');
  if (gkAttr) {
    return `[data-guidekit-component="${CSS.escape(gkAttr)}"]`;
  }

  // data-testid
  const testId = el.getAttribute('data-testid');
  if (testId) {
    return `[data-testid="${CSS.escape(testId)}"]`;
  }

  // ARIA role + position
  const role = el.getAttribute('role');
  if (role) {
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.querySelectorAll(`:scope > [role="${CSS.escape(role)}"]`));
      if (siblings.length === 1) {
        return `${generateSelector(parent)} > [role="${CSS.escape(role)}"]`;
      }
      const idx = siblings.indexOf(el);
      return `${generateSelector(parent)} > [role="${CSS.escape(role)}"]:nth-of-type(${idx + 1})`;
    }
    return `[role="${CSS.escape(role)}"]`;
  }

  // Fallback: tag + nth-child from parent
  const parent = el.parentElement;
  if (parent) {
    const tag = el.tagName.toLowerCase();
    const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
    if (siblings.length === 1) {
      return `${generateSelector(parent)} > ${tag}`;
    }
    const idx = siblings.indexOf(el) + 1;
    return `${generateSelector(parent)} > ${tag}:nth-child(${idx})`;
  }

  return el.tagName.toLowerCase();
}

/**
 * Extract a human-readable label for a component element.
 * Checks: aria-label, aria-labelledby, heading children, first text content.
 */
function extractLabel(el: Element, root: Element): string {
  // aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  // aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ownerDoc = el.ownerDocument ?? (root.ownerDocument || root);
    const ids = labelledBy.split(/\s+/);
    const parts: string[] = [];
    for (const id of ids) {
      const ref = (ownerDoc as Document).getElementById(id);
      if (ref?.textContent) {
        parts.push(ref.textContent.trim());
      }
    }
    if (parts.length > 0) return parts.join(' ');
  }

  // Heading child
  const heading = el.querySelector('h1, h2, h3, h4, h5, h6');
  if (heading?.textContent) return heading.textContent.trim().slice(0, 120);

  // legend (for fieldsets / form wizards)
  const legend = el.querySelector('legend, caption');
  if (legend?.textContent) return legend.textContent.trim().slice(0, 120);

  // title attribute
  const title = el.getAttribute('title');
  if (title) return title.trim();

  // First meaningful text (truncated)
  const text = el.textContent?.trim() ?? '';
  if (text.length > 0) {
    return text.slice(0, 80) + (text.length > 80 ? '...' : '');
  }

  return '';
}

/**
 * Collect selectors of interactive child elements.
 */
function getInteractiveElements(el: Element): string[] {
  const children = el.querySelectorAll(INTERACTIVE_SELECTOR);
  const selectors: string[] = [];
  const limit = 30; // cap for performance
  for (let i = 0; i < children.length && selectors.length < limit; i++) {
    const child = children[i];
    if (child) {
      selectors.push(generateSelector(child));
    }
  }
  return selectors;
}

/**
 * Extract component-specific state where possible (cheap DOM reads only).
 */
function extractState(el: Element, type: ComponentType): Record<string, unknown> | undefined {
  switch (type) {
    case 'tab-group': {
      const tabs = el.querySelectorAll('[role="tab"]');
      let activeIndex = -1;
      const tabLabels: string[] = [];
      tabs.forEach((tab, i) => {
        tabLabels.push(tab.textContent?.trim() ?? '');
        if (tab.getAttribute('aria-selected') === 'true') {
          activeIndex = i;
        }
      });
      return { activeTabIndex: activeIndex, tabCount: tabs.length, tabLabels };
    }
    case 'modal': {
      const isOpen =
        el.getAttribute('aria-hidden') !== 'true' &&
        !el.classList.contains('hidden') &&
        !(el as HTMLElement).hidden;
      return { open: isOpen };
    }
    case 'accordion': {
      const panels = el.querySelectorAll(
        '[aria-expanded], details'
      );
      const expandedIndices: number[] = [];
      panels.forEach((panel, i) => {
        const isExpanded =
          panel.getAttribute('aria-expanded') === 'true' ||
          (panel as HTMLDetailsElement).open === true;
        if (isExpanded) expandedIndices.push(i);
      });
      return { expandedPanels: expandedIndices, panelCount: panels.length };
    }
    case 'data-table': {
      const rows = el.querySelectorAll('tbody tr, tr');
      const cols = el.querySelectorAll('thead th, th');
      return { rowCount: rows.length, columnCount: cols.length };
    }
    case 'form-wizard': {
      const steps = el.querySelectorAll('[aria-current="step"], .step, .wizard-step');
      return { stepCount: steps.length };
    }
    case 'dropdown': {
      const isExpanded = el.getAttribute('aria-expanded') === 'true';
      return { expanded: isExpanded };
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Detection strategies
// ---------------------------------------------------------------------------

/**
 * Strategy 1: Developer-annotated elements (highest confidence).
 */
function detectAnnotated(root: Element): CandidateMatch[] {
  const results: CandidateMatch[] = [];
  const elements = root.querySelectorAll('[data-guidekit-component]');

  elements.forEach((el) => {
    const rawType = el.getAttribute('data-guidekit-component')!;
    const type = normalizeType(rawType);
    results.push({ element: el, type, confidence: 1.0, source: 'annotated' });
  });

  return results;
}

/** Normalize a raw type string to a valid ComponentType. */
function normalizeType(raw: string): ComponentType {
  const normalized = raw.toLowerCase().trim();
  const valid: ComponentType[] = [
    'tab-group', 'modal', 'accordion', 'card', 'form-wizard',
    'data-table', 'search', 'breadcrumb', 'dropdown',
  ];
  if ((valid as string[]).includes(normalized)) return normalized as ComponentType;
  return 'unknown';
}

/**
 * Strategy 2: ARIA role patterns.
 */
function detectAria(root: Element): CandidateMatch[] {
  const results: CandidateMatch[] = [];

  // Tablist → tab-group
  root.querySelectorAll('[role="tablist"]').forEach((el) => {
    results.push({ element: el, type: 'tab-group', confidence: 0.95, source: 'aria' });
  });

  // Dialog / alertdialog → modal
  root.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog').forEach((el) => {
    results.push({ element: el, type: 'modal', confidence: 0.9, source: 'aria' });
  });

  // Menu / menubar → dropdown
  root.querySelectorAll('[role="menu"], [role="menubar"]').forEach((el) => {
    results.push({ element: el, type: 'dropdown', confidence: 0.85, source: 'aria' });
  });

  // nav with breadcrumb aria-label or class
  root.querySelectorAll('nav').forEach((el) => {
    const label = (el.getAttribute('aria-label') ?? '').toLowerCase();
    const cls = el.className?.toLowerCase?.() ?? '';
    if (label.includes('breadcrumb') || cls.includes('breadcrumb')) {
      results.push({ element: el, type: 'breadcrumb', confidence: 0.9, source: 'aria' });
    }
  });

  // Search role
  root.querySelectorAll('[role="search"], [role="searchbox"]').forEach((el) => {
    // For searchbox inputs, go up to the containing form/div
    const target = el.closest('form') ?? el.parentElement ?? el;
    results.push({ element: target, type: 'search', confidence: 0.85, source: 'aria' });
  });

  // Tables with role or semantic <table>
  root.querySelectorAll('table, [role="table"], [role="grid"]').forEach((el) => {
    results.push({ element: el, type: 'data-table', confidence: 0.8, source: 'aria' });
  });

  return results;
}

/**
 * Strategy 3: CSS class pattern matching.
 */
function detectByClass(root: Element): CandidateMatch[] {
  const results: CandidateMatch[] = [];
  let elements: NodeListOf<Element>;
  try {
    elements = root.querySelectorAll(CLASS_CANDIDATE_SELECTORS);
  } catch {
    return results;
  }

  elements.forEach((el) => {
    const cls = el.className;
    if (typeof cls !== 'string') return;

    for (const { pattern, type, confidence } of CLASS_PATTERNS) {
      if (pattern.test(cls)) {
        results.push({ element: el, type, confidence, source: 'class' });
        break; // First match wins per element
      }
    }
  });

  return results;
}

/**
 * Strategy 4: Structural heuristics — repeated siblings with same tag+class → cards.
 */
function detectStructural(root: Element): CandidateMatch[] {
  const results: CandidateMatch[] = [];
  const MIN_REPEATS = 3;

  // Check common list containers
  const containers = root.querySelectorAll('ul, ol, div, section, main');
  const seen = new WeakSet<Element>();

  containers.forEach((container) => {
    if (seen.has(container)) return;

    const children = container.children;
    if (children.length < MIN_REPEATS) return;

    // Group children by tag + first class token
    const signatureMap = new Map<string, Element[]>();

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!child) continue;
      const tag = child.tagName;
      const firstClass = child.classList[0] ?? '';
      const sig = `${tag}.${firstClass}`;
      let group = signatureMap.get(sig);
      if (!group) {
        group = [];
        signatureMap.set(sig, group);
      }
      group.push(child);
    }

    for (const [, group] of signatureMap) {
      if (group.length >= MIN_REPEATS) {
        // These look like repeated card-like items — mark the container
        if (!seen.has(container)) {
          seen.add(container);
          results.push({
            element: container,
            type: 'card',
            confidence: 0.5,
            source: 'structural',
          });
        }
      }
    }
  });

  return results;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * When multiple strategies detect the same element, keep the one with highest confidence.
 * Annotated always wins (confidence 1.0).
 */
function deduplicateMatches(matches: CandidateMatch[]): CandidateMatch[] {
  const best = new Map<Element, CandidateMatch>();

  for (const match of matches) {
    const existing = best.get(match.element);
    if (!existing || match.confidence > existing.confidence) {
      best.set(match.element, match);
    }
  }

  return Array.from(best.values());
}

// ---------------------------------------------------------------------------
// ComponentDetector
// ---------------------------------------------------------------------------

export class ComponentDetector {
  /**
   * Detect UI component patterns within the given root element.
   * Returns an array of ComponentNode descriptors sorted by document order.
   */
  detect(root: Element): ComponentNode[] {
    // Run all detection strategies
    const allMatches = [
      ...detectAnnotated(root),
      ...detectAria(root),
      ...detectByClass(root),
      ...detectStructural(root),
    ];

    // Deduplicate — highest confidence per element wins
    const unique = deduplicateMatches(allMatches);

    // Build ComponentNode results
    const typeCounters = new Map<string, number>();
    const nodes: ComponentNode[] = [];

    for (const match of unique) {
      const count = (typeCounters.get(match.type) ?? 0) + 1;
      typeCounters.set(match.type, count);

      const id = `gk-comp-${match.type}-${count}`;
      const selector = generateSelector(match.element);
      const label = extractLabel(match.element, root);
      const interactiveElements = getInteractiveElements(match.element);
      const state = extractState(match.element, match.type);

      const node: ComponentNode = {
        id,
        type: match.type,
        selector,
        label,
        confidence: match.confidence,
        interactiveElements,
      };

      if (state !== undefined) {
        node.state = state;
      }

      nodes.push(node);
    }

    return nodes;
  }
}
