/**
 * @module @guidekit/core/dom
 *
 * DOM intelligence engine for the GuideKit SDK.
 * Scans the current page and builds a structured PageModel that serves as
 * grounding context for the LLM on every turn.
 *
 * Key design decisions:
 * - SSR-safe: every browser API is guarded behind `typeof document/window`.
 * - Privacy-first: password fields and PII patterns are never captured.
 * - Budget-constrained: hard limits on node count and tree depth prevent
 *   runaway scans on large pages.
 * - Mutation-resilient: MutationObserver is throttled and circuit-broken.
 */

import type {
  PageModel,
  PageSection,
  NavItem,
  InteractiveElement,
  FormSummary,
  FormField,
  OverlayElement,
  ScanMetadata,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_NODES = 5000;
const DEFAULT_MAX_SECTIONS = 20;
const DEFAULT_MAX_DEPTH = 15;

const MUTATION_DEBOUNCE_MS = 500;
const MUTATION_CIRCUIT_BREAKER_THRESHOLD = 100; // mutations per second
const CIRCUIT_BREAKER_COOLDOWN_MS = 2000;
const MIN_RESCAN_INTERVAL_MS = 2000;

const LOG_PREFIX = '[GuideKit:DOM]';

/** Semantic tags that qualify as sections without additional attributes. */
const SECTION_TAGS = new Set([
  'SECTION',
  'ARTICLE',
  'MAIN',
  'ASIDE',
  'HEADER',
  'FOOTER',
  'NAV',
]);

/** Tags that map to landmark roles for scoring. */
const LANDMARK_TAG_MAP: Record<string, string> = {
  HEADER: 'banner',
  FOOTER: 'contentinfo',
  NAV: 'navigation',
  MAIN: 'main',
  ASIDE: 'complementary',
};

/** Interactive element selectors. */
const INTERACTIVE_SELECTOR =
  'button, a[href], input, select, textarea, [role="button"], [role="link"], [tabindex]';

/** Tags whose text value must never be captured. */
const SENSITIVE_INPUT_TYPES = new Set(['password', 'tel', 'email']);

/** PII regex patterns stripped from text content. */
const PII_PATTERNS: RegExp[] = [
  // Email addresses
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  // US phone numbers (various formats)
  /(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g,
  // SSN
  /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g,
  // Credit card numbers (basic)
  /\b(?:\d[ -]*?){13,19}\b/g,
];

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Simple string hash (djb2). */
function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** Strip PII from a string. */
function stripPII(text: string): string {
  let result = text;
  for (const pattern of PII_PATTERNS) {
    // Reset lastIndex for global regexps that are reused
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

/** Truncate a string to a max length, adding ellipsis if needed. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '\u2026';
}

/** Collapse whitespace in a string. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Get visible text content from an element, limited in length. */
function getTextContent(el: Element, maxLen: number = 200): string {
  const raw = el.textContent ?? '';
  return stripPII(truncate(collapseWhitespace(raw), maxLen));
}

/** Check whether an element is visible in the layout sense (not IntersectionObserver). */
function isElementVisible(el: Element): boolean {
  if (typeof window === 'undefined') return false;
  const style = window.getComputedStyle(el);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0'
  );
}

/** Get an accessible label for an element. */
function getAccessibleLabel(el: Element): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  const ariaLabelledBy = el.getAttribute('aria-labelledby');
  if (ariaLabelledBy && typeof document !== 'undefined') {
    const labelEl = document.getElementById(ariaLabelledBy);
    if (labelEl) return collapseWhitespace(labelEl.textContent ?? '');
  }

  return '';
}

/** Request idle callback with fallback. */
function scheduleIdle(cb: () => void): void {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(cb);
  } else if (typeof setTimeout !== 'undefined') {
    setTimeout(cb, 0);
  } else {
    cb();
  }
}

// ---------------------------------------------------------------------------
// Selector builder
// ---------------------------------------------------------------------------

/**
 * Build a stable CSS selector for an element following the priority hierarchy:
 * 1. data-guidekit-target
 * 2. id
 * 3. data-testid
 * 4. aria-label
 * 5. Structural path fallback
 */
function buildSelector(el: Element): string {
  // 1. GuideKit target (highest priority)
  const guideKitTarget = el.getAttribute('data-guidekit-target');
  if (guideKitTarget) {
    return `[data-guidekit-target="${guideKitTarget}"]`;
  }

  // 2. ID
  const id = el.id;
  if (id && typeof document !== 'undefined') {
    // Verify uniqueness
    try {
      const matches = document.querySelectorAll(`#${CSS.escape(id)}`);
      if (matches.length === 1) {
        return `#${CSS.escape(id)}`;
      }
    } catch {
      // CSS.escape may not be available; fall through
    }
  }

  // 3. data-testid
  const testId = el.getAttribute('data-testid');
  if (testId) {
    return `[data-testid="${testId}"]`;
  }

  // 4. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    return `[aria-label="${ariaLabel}"]`;
  }

  // 5. Structural path fallback
  return buildStructuralPath(el);
}

/** Build a structural CSS selector path from root to the element. */
function buildStructuralPath(el: Element): string {
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

// ---------------------------------------------------------------------------
// Section ID generation
// ---------------------------------------------------------------------------

let sectionCounter = 0;

function generateSectionId(el: Element): string {
  const guideKitTarget = el.getAttribute('data-guidekit-target');
  if (guideKitTarget) return guideKitTarget;

  const id = el.id;
  if (id) return id;

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    return ariaLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  sectionCounter += 1;
  return `section-${sectionCounter}`;
}

// ---------------------------------------------------------------------------
// DOMScanner
// ---------------------------------------------------------------------------

export interface DOMScannerOptions {
  rootElement?: HTMLElement;
  debug?: boolean;
  maxNodes?: number;
  maxSections?: number;
  maxDepth?: number;
}

export class DOMScanner {
  private readonly root: HTMLElement | null;
  private readonly debug: boolean;
  private readonly maxNodes: number;
  private readonly maxSections: number;
  private readonly maxDepth: number;

  private cachedModel: PageModel | null = null;

  // Visibility tracking (updated via IntersectionObserver)
  private visibilityMap: Map<Element, number> = new Map();

  // MutationObserver state
  private observer: MutationObserver | null = null;
  private mutationCount = 0;
  private mutationWindowStart = 0;
  private circuitBroken = false;
  private circuitBrokenTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastScanTime = 0;

  constructor(options?: DOMScannerOptions) {
    const isBrowser =
      typeof document !== 'undefined' && typeof window !== 'undefined';

    this.root = options?.rootElement ?? (isBrowser ? document.body : null);
    this.debug = options?.debug ?? false;
    this.maxNodes = options?.maxNodes ?? DEFAULT_MAX_NODES;
    this.maxSections = options?.maxSections ?? DEFAULT_MAX_SECTIONS;
    this.maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;

    this.log('Initialised', {
      root: this.root?.tagName,
      maxNodes: this.maxNodes,
      maxSections: this.maxSections,
      maxDepth: this.maxDepth,
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Perform a full scan and return a PageModel. */
  scan(): PageModel {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      this.log('SSR environment detected, returning empty model');
      return this.emptyModel();
    }

    if (!this.root) {
      this.log('No root element available, returning empty model');
      return this.emptyModel();
    }

    this.log('Starting scan');
    const startTime = performance.now();

    // Reset section counter per scan
    sectionCounter = 0;

    let nodesScanned = 0;
    let budgetExhausted = false;

    // Phase 1: Walk DOM and collect candidate section elements
    const candidateSections: Array<{ el: Element; depth: number }> = [];
    const allElements: Element[] = [];

    const walker = document.createTreeWalker(
      this.root,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node: Node): number => {
          const el = node as Element;

          // Skip guidekit-ignore subtrees
          if (el.hasAttribute('data-guidekit-ignore')) {
            return NodeFilter.FILTER_REJECT;
          }

          // Budget check
          if (nodesScanned >= this.maxNodes) {
            budgetExhausted = true;
            return NodeFilter.FILTER_REJECT;
          }

          nodesScanned++;
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    // Walk the tree
    let currentNode = walker.nextNode();
    while (currentNode) {
      const el = currentNode as Element;
      allElements.push(el);

      // Check if this is a candidate section
      const depth = this.getDepth(el);
      if (depth <= this.maxDepth && this.isSectionCandidate(el)) {
        candidateSections.push({ el, depth });
      }

      currentNode = walker.nextNode();
    }

    this.log(`Walked ${nodesScanned} nodes, found ${candidateSections.length} section candidates`);

    // Phase 2: Extract page data
    const sections = this.extractSections(candidateSections);
    const navigation = this.extractNavigation();
    const interactiveElements = this.extractInteractiveElements();
    const forms = this.extractForms();
    const activeOverlays = this.extractOverlays();
    const meta = this.extractMeta();

    const scanMetadata: ScanMetadata = {
      totalSectionsFound: candidateSections.length,
      sectionsIncluded: sections.length,
      totalNodesScanned: nodesScanned,
      scanBudgetExhausted: budgetExhausted,
    };

    const model: PageModel = {
      url: window.location.href,
      title: document.title ?? '',
      meta,
      sections,
      navigation,
      interactiveElements,
      forms,
      activeOverlays,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        orientation:
          window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait',
      },
      allSectionsSummary: sections.map(
        (s) => `[${s.label}] ${s.summary}`,
      ),
      hash: '',
      timestamp: Date.now(),
      scanMetadata,
    };

    // Generate hash from key model content
    model.hash = this.generateHash(model);

    this.cachedModel = model;

    const elapsed = (performance.now() - startTime).toFixed(1);
    this.log(`Scan complete in ${elapsed}ms`, {
      sections: sections.length,
      navItems: navigation.length,
      interactive: interactiveElements.length,
      forms: forms.length,
      overlays: activeOverlays.length,
      nodesScanned,
      budgetExhausted,
    });

    return model;
  }

  /**
   * Set up a MutationObserver that rescans on DOM changes.
   * Returns a cleanup function to disconnect the observer.
   */
  observe(callback: (model: PageModel) => void): () => void {
    if (typeof MutationObserver === 'undefined' || !this.root) {
      this.log('MutationObserver not available or no root');
      return () => {};
    }

    this.log('Starting observation');

    const handleMutations = (_mutations: MutationRecord[]) => {
      const now = Date.now();

      // --- Circuit breaker ---
      if (now - this.mutationWindowStart > 1000) {
        // New one-second window
        this.mutationCount = _mutations.length;
        this.mutationWindowStart = now;
      } else {
        this.mutationCount += _mutations.length;
      }

      if (this.mutationCount > MUTATION_CIRCUIT_BREAKER_THRESHOLD) {
        if (!this.circuitBroken) {
          this.circuitBroken = true;
          this.log('Circuit breaker tripped — pausing observation');

          // Disconnect temporarily
          this.observer?.disconnect();

          this.circuitBrokenTimer = setTimeout(() => {
            this.circuitBroken = false;
            this.mutationCount = 0;
            this.log('Circuit breaker reset — resuming observation');
            this.startObserving();
            this.triggerRescan(callback);
          }, CIRCUIT_BREAKER_COOLDOWN_MS);
        }
        return;
      }

      // --- Debounce ---
      if (this.debounceTimer !== null) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.triggerRescan(callback);
      }, MUTATION_DEBOUNCE_MS);
    };

    this.observer = new MutationObserver(handleMutations);
    this.startObserving();

    // Return cleanup function
    return () => {
      this.log('Stopping observation');
      this.cleanup();
    };
  }

  /** Update visibility data from an IntersectionObserver. */
  updateVisibility(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      this.visibilityMap.set(entry.target, entry.intersectionRatio);
    }
  }

  /** Get the current cached page model. */
  get currentModel(): PageModel | null {
    return this.cachedModel;
  }

  // -------------------------------------------------------------------------
  // Private: Observation helpers
  // -------------------------------------------------------------------------

  private startObserving(): void {
    if (!this.observer || !this.root) return;

    this.observer.observe(this.root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'class',
        'style',
        'hidden',
        'aria-hidden',
        'aria-label',
        'role',
        'data-guidekit-target',
        'data-guidekit-ignore',
        'disabled',
      ],
    });
  }

  private triggerRescan(callback: (model: PageModel) => void): void {
    const now = Date.now();
    if (now - this.lastScanTime < MIN_RESCAN_INTERVAL_MS) {
      this.log('Rescan throttled');
      return;
    }

    this.lastScanTime = now;

    scheduleIdle(() => {
      const model = this.scan();
      callback(model);
    });
  }

  private cleanup(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.circuitBrokenTimer !== null) {
      clearTimeout(this.circuitBrokenTimer);
      this.circuitBrokenTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Private: Section extraction
  // -------------------------------------------------------------------------

  private isSectionCandidate(el: Element): boolean {
    const tag = el.tagName;

    // Semantic section tags
    if (SECTION_TAGS.has(tag)) return true;

    // Divs or other elements with role, aria-label, or id
    if (
      el.getAttribute('role') ||
      el.getAttribute('aria-label') ||
      el.id
    ) {
      return true;
    }

    return false;
  }

  private extractSections(
    candidates: Array<{ el: Element; depth: number }>,
  ): PageSection[] {
    const scored: PageSection[] = [];

    for (const { el, depth } of candidates) {
      const section = this.buildPageSection(el, depth);
      scored.push(section);
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Take top N
    return scored.slice(0, this.maxSections);
  }

  private buildPageSection(el: Element, depth: number): PageSection {
    const tag = el.tagName;
    const selector = buildSelector(el);

    // Determine label
    const label = this.getSectionLabel(el);

    // Get summary from first ~100 chars of text
    const summary = getTextContent(el, 100);

    // Check visibility
    const visRatio = this.visibilityMap.get(el) ?? 0;
    const isVisible = visRatio > 0 || this.isInViewport(el);

    // Check for interactive elements
    const hasInteractive =
      el.querySelector(INTERACTIVE_SELECTOR) !== null;

    // Determine landmark
    const landmark = this.getLandmark(el);

    // Has heading?
    const hasHeading = el.querySelector('h1, h2, h3, h4, h5, h6') !== null;

    // Score
    const score = this.scoreSection({
      isVisible,
      hasInteractive,
      landmark,
      hasHeading,
      depth,
      el,
    });

    return {
      id: generateSectionId(el),
      selector,
      tagName: tag.toLowerCase(),
      label,
      summary,
      isVisible,
      visibilityRatio: visRatio,
      score,
      landmark: landmark ?? undefined,
      hasInteractiveElements: hasInteractive,
      depth,
    };
  }

  private getSectionLabel(el: Element): string {
    // 1. aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    // 2. First heading
    const heading = el.querySelector('h1, h2, h3, h4, h5, h6');
    if (heading) {
      const text = collapseWhitespace(heading.textContent ?? '');
      if (text) return stripPII(truncate(text, 80));
    }

    // 3. id as fallback
    if (el.id) return el.id;

    // 4. Tag name
    return el.tagName.toLowerCase();
  }

  private getLandmark(el: Element): string | null {
    // Explicit role
    const role = el.getAttribute('role');
    if (role) return role;

    // Implicit landmark via tag
    const implicit = LANDMARK_TAG_MAP[el.tagName];
    if (implicit) return implicit;

    // section/article with aria-label count as landmarks
    if (
      (el.tagName === 'SECTION' || el.tagName === 'ARTICLE') &&
      el.getAttribute('aria-label')
    ) {
      return el.tagName === 'SECTION' ? 'region' : 'article';
    }

    return null;
  }

  private scoreSection(params: {
    isVisible: boolean;
    hasInteractive: boolean;
    landmark: string | null;
    hasHeading: boolean;
    depth: number;
    el: Element;
  }): number {
    let score = 0;

    if (params.isVisible) score += 100;
    if (params.hasInteractive) score += 20;
    if (params.landmark) score += 15;

    // Near scroll position
    if (typeof window !== 'undefined') {
      const rect = params.el.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      if (
        rect.top >= -viewportHeight &&
        rect.top <= viewportHeight * 2
      ) {
        score += 10;
      }
    }

    if (params.hasHeading) score += 5;

    // Depth penalty
    score -= params.depth * 2;

    return score;
  }

  // -------------------------------------------------------------------------
  // Private: Navigation extraction
  // -------------------------------------------------------------------------

  private extractNavigation(): NavItem[] {
    if (typeof document === 'undefined') return [];

    const navElements = this.root?.querySelectorAll('nav') ?? [];
    const items: NavItem[] = [];

    navElements.forEach((nav) => {
      if (nav.hasAttribute('data-guidekit-ignore')) return;

      const links = nav.querySelectorAll('a[href]');
      links.forEach((link) => {
        const anchor = link as HTMLAnchorElement;
        const label = collapseWhitespace(anchor.textContent ?? '');
        if (!label) return;

        const href = anchor.getAttribute('href') ?? '';
        const isCurrent =
          anchor.getAttribute('aria-current') === 'page' ||
          anchor.classList.contains('active') ||
          (typeof window !== 'undefined' && anchor.href === window.location.href);

        items.push({
          label: stripPII(truncate(label, 60)),
          href,
          isCurrent,
          selector: buildSelector(anchor),
        });
      });
    });

    return items;
  }

  // -------------------------------------------------------------------------
  // Private: Interactive elements extraction
  // -------------------------------------------------------------------------

  private extractInteractiveElements(): InteractiveElement[] {
    if (typeof document === 'undefined' || !this.root) return [];

    const elements = this.root.querySelectorAll(INTERACTIVE_SELECTOR);
    const result: InteractiveElement[] = [];

    elements.forEach((el) => {
      // Skip elements inside ignored subtrees
      if (el.closest('[data-guidekit-ignore]')) return;

      const htmlEl = el as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type') ?? undefined;

      // Skip sensitive input types — never capture their labels from value/placeholder
      const isSensitive =
        tag === 'input' && SENSITIVE_INPUT_TYPES.has(type ?? '');

      // Get label
      let label = getAccessibleLabel(el);
      if (!label && !isSensitive) {
        label = collapseWhitespace(el.textContent ?? '');
      }
      if (!label) {
        const placeholder = el.getAttribute('placeholder');
        if (placeholder && !isSensitive) {
          label = placeholder;
        }
      }
      if (!label && el.getAttribute('title')) {
        label = el.getAttribute('title') ?? '';
      }
      if (!label && isSensitive) {
        label = type ?? 'input';
      }
      label = stripPII(truncate(label, 60));

      const role = el.getAttribute('role') ?? undefined;
      const isDisabled =
        htmlEl.hasAttribute('disabled') ||
        htmlEl.getAttribute('aria-disabled') === 'true';
      const guideKitTarget =
        el.getAttribute('data-guidekit-target') ?? undefined;

      result.push({
        selector: buildSelector(el),
        tagName: tag,
        type,
        label,
        role,
        isDisabled,
        guideKitTarget,
      });
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // Private: Form extraction
  // -------------------------------------------------------------------------

  private extractForms(): FormSummary[] {
    if (typeof document === 'undefined' || !this.root) return [];

    const formElements = this.root.querySelectorAll('form');
    const result: FormSummary[] = [];

    formElements.forEach((form) => {
      if (form.closest('[data-guidekit-ignore]')) return;

      const fields = this.extractFormFields(form);
      const hasValidationErrors = fields.some((f) => f.hasError);

      result.push({
        selector: buildSelector(form),
        id: form.id || undefined,
        action: form.action || undefined,
        fields,
        hasValidationErrors,
      });
    });

    return result;
  }

  private extractFormFields(form: HTMLFormElement): FormField[] {
    const fields: FormField[] = [];
    const fieldElements = form.querySelectorAll(
      'input, select, textarea',
    );

    fieldElements.forEach((el) => {
      const input = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const name = input.name || input.id || '';
      const type =
        el.tagName === 'SELECT'
          ? 'select'
          : el.tagName === 'TEXTAREA'
            ? 'textarea'
            : (el as HTMLInputElement).type || 'text';

      // Find label
      let label = '';
      if (input.id && typeof document !== 'undefined') {
        const labelEl = document.querySelector(
          `label[for="${CSS.escape(input.id)}"]`,
        );
        if (labelEl) {
          label = collapseWhitespace(labelEl.textContent ?? '');
        }
      }
      if (!label) {
        // Check for wrapping label
        const parentLabel = input.closest('label');
        if (parentLabel) {
          label = collapseWhitespace(parentLabel.textContent ?? '');
        }
      }
      if (!label) {
        label = getAccessibleLabel(el);
      }
      if (!label) {
        const placeholder = el.getAttribute('placeholder');
        label = placeholder ?? name;
      }
      label = stripPII(truncate(label, 60));

      // Required?
      const isRequired =
        input.hasAttribute('required') ||
        input.getAttribute('aria-required') === 'true';

      // Validation error
      const hasError =
        input.getAttribute('aria-invalid') === 'true' ||
        (input instanceof HTMLInputElement && !input.validity.valid && input.value !== '');

      let errorMessage: string | undefined;
      const errorId = input.getAttribute('aria-errormessage') ?? input.getAttribute('aria-describedby');
      if (hasError && errorId && typeof document !== 'undefined') {
        const errorEl = document.getElementById(errorId);
        if (errorEl) {
          errorMessage = collapseWhitespace(errorEl.textContent ?? '');
        }
      }
      if (hasError && !errorMessage && input instanceof HTMLInputElement) {
        errorMessage = input.validationMessage || undefined;
      }

      fields.push({
        selector: buildSelector(el),
        name,
        type,
        label,
        isRequired,
        hasError,
        errorMessage,
      });
    });

    return fields;
  }

  // -------------------------------------------------------------------------
  // Private: Overlay detection
  // -------------------------------------------------------------------------

  private extractOverlays(): OverlayElement[] {
    if (typeof document === 'undefined' || typeof window === 'undefined' || !this.root) {
      return [];
    }

    const result: OverlayElement[] = [];

    // 1. Elements with explicit dialog roles
    const dialogElements = this.root.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], dialog',
    );
    dialogElements.forEach((el) => {
      if (el.closest('[data-guidekit-ignore]')) return;
      const label = getAccessibleLabel(el) || getTextContent(el, 40) || 'dialog';
      result.push({
        selector: buildSelector(el),
        type: 'modal',
        label: stripPII(label),
        isVisible: isElementVisible(el),
      });
    });

    // 2. Common modal patterns: high z-index + fixed/absolute positioning
    const allElements = this.root.querySelectorAll('*');
    const seen = new Set<Element>(dialogElements);

    allElements.forEach((el) => {
      if (seen.has(el)) return;
      if (el.closest('[data-guidekit-ignore]')) return;

      const style = window.getComputedStyle(el);
      const position = style.position;
      const zIndex = parseInt(style.zIndex, 10);

      if (
        (position === 'fixed' || position === 'absolute') &&
        !isNaN(zIndex) &&
        zIndex >= 1000
      ) {
        const visible = isElementVisible(el);
        if (!visible) return;

        // Determine overlay type heuristically
        const overlayType = this.classifyOverlay(el, style);
        if (!overlayType) return;

        const label =
          getAccessibleLabel(el) || getTextContent(el, 40) || overlayType;

        result.push({
          selector: buildSelector(el),
          type: overlayType,
          label: stripPII(label),
          isVisible: visible,
        });
      }
    });

    return result;
  }

  private classifyOverlay(
    el: Element,
    style: CSSStyleDeclaration,
  ): OverlayElement['type'] | null {
    const role = el.getAttribute('role');
    if (role === 'dialog' || role === 'alertdialog') return 'modal';
    if (role === 'menu' || role === 'listbox') return 'dropdown';

    // Check class names for hints
    const className = el.className?.toString?.() ?? '';
    const lower = className.toLowerCase();

    if (lower.includes('modal') || lower.includes('dialog')) return 'modal';
    if (lower.includes('drawer') || lower.includes('sidebar')) return 'drawer';
    if (
      lower.includes('dropdown') ||
      lower.includes('menu') ||
      lower.includes('popover')
    )
      return 'dropdown';

    // Fixed elements covering large area are likely modals
    const width = parseFloat(style.width);
    const height = parseFloat(style.height);
    if (
      typeof window !== 'undefined' &&
      !isNaN(width) &&
      !isNaN(height) &&
      width > window.innerWidth * 0.5 &&
      height > window.innerHeight * 0.5
    ) {
      return 'modal';
    }

    // Small positioned element is likely a popover
    if (!isNaN(width) && width < 400) return 'popover';

    return null;
  }

  // -------------------------------------------------------------------------
  // Private: Meta extraction
  // -------------------------------------------------------------------------

  private extractMeta(): PageModel['meta'] {
    if (typeof document === 'undefined') {
      return { description: '', h1: null, language: 'en' };
    }

    const descMeta = document.querySelector('meta[name="description"]');
    const description = descMeta?.getAttribute('content') ?? '';

    const h1El = document.querySelector('h1');
    const h1 = h1El ? stripPII(collapseWhitespace(h1El.textContent ?? '')) : null;

    const language =
      document.documentElement.getAttribute('lang') ?? 'en';

    return {
      description: stripPII(description),
      h1,
      language,
    };
  }

  // -------------------------------------------------------------------------
  // Private: Helpers
  // -------------------------------------------------------------------------

  private getDepth(el: Element): number {
    let depth = 0;
    let current: Element | null = el;
    const root = this.root;

    while (current && current !== root && depth < this.maxDepth + 1) {
      current = current.parentElement;
      depth++;
    }

    return depth;
  }

  private isInViewport(el: Element): boolean {
    if (typeof window === 'undefined') return false;
    try {
      const rect = el.getBoundingClientRect();
      return (
        rect.top < window.innerHeight &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.right > 0
      );
    } catch {
      return false;
    }
  }

  private generateHash(model: PageModel): string {
    // Hash key structural content for change detection
    const content = [
      model.url,
      model.title,
      model.meta.h1 ?? '',
      model.sections.map((s) => `${s.id}:${s.label}`).join(','),
      model.navigation.map((n) => n.href).join(','),
      model.interactiveElements.length.toString(),
      model.forms.length.toString(),
      model.activeOverlays.length.toString(),
    ].join('|');

    return djb2Hash(content);
  }

  private emptyModel(): PageModel {
    return {
      url: typeof window !== 'undefined' ? window.location.href : '',
      title: typeof document !== 'undefined' ? document.title ?? '' : '',
      meta: { description: '', h1: null, language: 'en' },
      sections: [],
      navigation: [],
      interactiveElements: [],
      forms: [],
      activeOverlays: [],
      viewport: { width: 0, height: 0, orientation: 'portrait' },
      allSectionsSummary: [],
      hash: '',
      timestamp: Date.now(),
      scanMetadata: {
        totalSectionsFound: 0,
        sectionsIncluded: 0,
        totalNodesScanned: 0,
        scanBudgetExhausted: false,
      },
    };
  }

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
