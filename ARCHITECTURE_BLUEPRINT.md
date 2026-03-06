# GuideKit v2 — Engineering Blueprint

## Lead Architect Decision: APPROVED FOR IMPLEMENTATION

**Date**: 2026-03-06
**Status**: Final — Full team consensus
**Goal**: Transform GuideKit into the most capable AI guidance SDK in the developer ecosystem

---

## I. ARCHITECTURAL VISION

GuideKit v1 is a **chat widget that knows about the page**.
GuideKit v2 will be an **intelligent agent platform that deeply understands web applications**.

The difference: v1 scans DOM and sends text to an LLM. v2 builds a **semantic model** of the application, reasons about user intent through an **agentic planning loop**, retrieves relevant knowledge from a **RAG pipeline**, and renders rich **adaptive responses** — all through an **extensible plugin architecture** that lets developers customize every layer.

### Core Principles

1. **Understand, don't just scan** — Build semantic models, not DOM dumps
2. **Plan, don't just respond** — Agentic reasoning with multi-step tool chains
3. **Remember, don't just process** — Tiered memory across turns, sessions, and users
4. **Extend, don't just configure** — Plugin architecture at every layer
5. **Measure, don't just hope** — Observability, confidence scoring, quality metrics

---

## II. SYSTEM ARCHITECTURE

```
                         ┌─────────────────────────────────────────────┐
                         │              Developer API                  │
                         │  GuideKit.init() / <GuideKitProvider>       │
                         └──────────────────┬──────────────────────────┘
                                            │
                    ┌───────────────────────┤
                    │                       │
          ┌─────────▼──────────┐  ┌─────────▼──────────────┐
          │   Plugin Registry  │  │   Middleware Pipeline   │
          │                    │  │                         │
          │  providers[]       │  │  before:scan            │
          │  tools[]           │  │  after:scan             │
          │  renderers[]       │  │  before:llm             │
          │  middleware[]      │  │  after:llm              │
          │  themes[]          │  │  before:tool            │
          └────────────────────┘  │  after:tool             │
                                  │  before:render          │
                                  │  after:render           │
                                  └─────────────────────────┘
                                            │
          ┌─────────────────────────────────┼─────────────────────────────────┐
          │                                 │                                 │
┌─────────▼──────────┐    ┌────────────────▼───────────────┐   ┌─────────────▼─────────┐
│  Page Intelligence │    │      Cognitive Engine           │   │    Presentation Layer  │
│                    │    │                                 │   │                        │
│  SemanticScanner   │    │  ┌───────────┐ ┌────────────┐  │   │  MarkdownRenderer      │
│  ComponentDetector │    │  │  Planner  │→│  Executor   │  │   │  AdaptiveCards         │
│  StateExtractor    │    │  └─────┬─────┘ └──────┬─────┘  │   │  SpotlightEngine       │
│  LayoutAnalyzer    │    │        │  ReAct Loop   │        │   │  TourController        │
│  FlowDetector      │    │  ┌─────▼─────┐ ┌──────▼─────┐  │   │  ThemeEngine            │
│  AccessibilityTree │    │  │  Observer │←│  Reasoner  │  │   │  HeadlessMode           │
│  ErrorDetector     │    │  └───────────┘ └────────────┘  │   └────────────────────────┘
│  MediaExtractor    │    │                                 │
└────────┬───────────┘    │  ModelRouter  TokenBudget       │
         │                │  ConfidenceScorer                │
         ▼                │  HallucinationGuard              │
┌────────────────────┐    └──────────────┬──────────────────┘
│   Context Engine   │                   │
│                    │    ┌──────────────▼──────────────────┐
│  TokenAwareBudget  │    │       Knowledge Layer           │
│  HierarchicalCtx   │    │                                 │
│  AttentionWeighted │    │  DocumentIngestion               │
│  CrossPageMemory   │    │  EmbeddingEngine (in-browser)    │
│  TieredMemory      │    │  VectorStore (IndexedDB)         │
│  SessionGraph      │    │  HybridSearch (semantic+keyword) │
│  ContextCompressor │    │  SourceAttribution               │
└────────────────────┘    └─────────────────────────────────┘
```

---

## III. PHASE 1 — SEMANTIC PAGE INTELLIGENCE ENGINE

**Owner**: *dom + *lead
**Impact**: This is THE differentiator. No competing SDK builds a true semantic model of a web page.

### III.1 Enhanced PageModel (Semantic Model)

Current `PageModel` captures flat lists of sections, nav items, and form fields.
The new `SemanticPageModel` captures the **meaning** of the page.

```typescript
// packages/core/src/intelligence/semantic-model.ts

interface SemanticPageModel extends PageModel {
  // ── Component Graph ──────────────────────────────────────────────
  /** Detected UI component patterns (cards, modals, tabs, accordions, etc.) */
  components: ComponentNode[];
  /** Parent-child relationships between components */
  componentTree: ComponentEdge[];

  // ── Layout Understanding ─────────────────────────────────────────
  /** Spatial layout analysis: grid/flex/flow detection */
  layout: LayoutAnalysis;
  /** Visual hierarchy: font sizes, weights, colors → importance ranking */
  visualHierarchy: VisualHierarchyNode[];

  // ── Application State ────────────────────────────────────────────
  /** Detected multi-step flow state (e.g., checkout step 2 of 4) */
  flowState: FlowState | null;
  /** Active error states visible on the page */
  errorStates: PageErrorState[];
  /** Loading/skeleton states currently present */
  loadingStates: LoadingState[];

  // ── Semantic Content ─────────────────────────────────────────────
  /** Extracted structured data (JSON-LD, microdata, Open Graph) */
  structuredData: StructuredDataEntry[];
  /** Image elements with alt text, captions, and context */
  media: MediaElement[];
  /** Heading outline (h1 → h2 → h3 hierarchy) */
  headingOutline: HeadingNode[];

  // ── Interaction Model ────────────────────────────────────────────
  /** Detected call-to-action elements ranked by visual prominence */
  callsToAction: CTAElement[];
  /** Keyboard shortcuts detected on the page */
  keyboardShortcuts: KeyboardShortcut[];
  /** Toast/notification elements currently visible */
  notifications: NotificationElement[];
}

interface ComponentNode {
  id: string;
  type: 'card' | 'modal' | 'tab-group' | 'accordion' | 'carousel'
      | 'data-table' | 'form-wizard' | 'search' | 'breadcrumb'
      | 'pagination' | 'tooltip' | 'dropdown' | 'sidebar' | 'hero'
      | 'pricing-table' | 'feature-grid' | 'testimonial' | 'unknown';
  selector: string;
  label: string;
  confidence: number; // 0-1 detection confidence
  children: string[]; // child component IDs
  interactiveElements: string[]; // selectors of interactive elements within
  state?: Record<string, unknown>; // component-specific state (e.g., active tab index)
}

interface FlowState {
  type: 'checkout' | 'signup' | 'onboarding' | 'wizard' | 'survey' | 'custom';
  currentStep: number;
  totalSteps: number;
  stepLabels: string[];
  completedSteps: number[];
  /** Selector of the progress indicator element */
  progressSelector?: string;
}

interface PageErrorState {
  type: 'form-validation' | 'api-error' | 'not-found' | 'permission'
      | 'network' | 'toast-error' | 'inline-error' | 'banner-error';
  message: string;
  selector: string;
  severity: 'error' | 'warning' | 'info';
  /** Related form field selector, if applicable */
  relatedField?: string;
  /** Whether the error is dismissible */
  dismissible: boolean;
}

interface VisualHierarchyNode {
  selector: string;
  /** Computed visual weight: fontSize * fontWeight * colorContrast * area */
  visualWeight: number;
  /** Semantic importance inferred from heading level, ARIA, position */
  semanticImportance: number;
  /** Combined rank (1 = most important on page) */
  rank: number;
}

interface CTAElement {
  selector: string;
  label: string;
  type: 'primary' | 'secondary' | 'link' | 'icon';
  /** Visual prominence score based on size, color, position */
  prominence: number;
  /** Inferred action (e.g., "purchase", "signup", "navigate") */
  inferredAction: string;
}
```

### III.2 Component Detection Engine

```typescript
// packages/core/src/intelligence/component-detector.ts

/**
 * Heuristic + ML pattern matcher that identifies UI components.
 *
 * Detection strategies (layered, highest confidence wins):
 * 1. data-guidekit-component attribute (developer-annotated)
 * 2. ARIA role + structure patterns (e.g., role="tablist" + role="tab")
 * 3. CSS class name pattern matching (e.g., .card, .modal, .accordion)
 * 4. Structural heuristics (repeated sibling patterns = cards/list)
 * 5. Visual analysis (getBoundingClientRect clustering)
 */

// Detection rule registry — extensible via plugins
interface ComponentDetectionRule {
  type: ComponentNode['type'];
  /** Priority (higher = checked first). Built-in rules: 100-900 */
  priority: number;
  /** Fast pre-check: does this element LOOK like this component? */
  precheck(el: Element): boolean;
  /** Full analysis: confirm detection and extract state */
  analyze(el: Element, children: Element[]): ComponentDetectionResult | null;
}

// Example built-in rules:

// Tab Group Detection
const tabGroupRule: ComponentDetectionRule = {
  type: 'tab-group',
  priority: 800,
  precheck: (el) =>
    el.getAttribute('role') === 'tablist' ||
    el.querySelector('[role="tab"]') !== null ||
    /\btabs?\b/i.test(el.className),
  analyze: (el) => {
    const tabs = el.querySelectorAll('[role="tab"]');
    if (tabs.length === 0) return null;
    const activeTab = el.querySelector('[role="tab"][aria-selected="true"]');
    return {
      type: 'tab-group',
      confidence: tabs.length > 0 ? 0.95 : 0.6,
      state: {
        activeIndex: activeTab ? Array.from(tabs).indexOf(activeTab) : 0,
        tabCount: tabs.length,
        tabLabels: Array.from(tabs).map(t => t.textContent?.trim() ?? ''),
      },
    };
  },
};

// Card Pattern Detection (repeated siblings with similar structure)
const cardPatternRule: ComponentDetectionRule = {
  type: 'card',
  priority: 500,
  precheck: (el) => {
    const siblings = el.parentElement?.children;
    if (!siblings || siblings.length < 2) return false;
    // Check if 3+ siblings share similar structure
    return Array.from(siblings).filter(s =>
      s.tagName === el.tagName &&
      Math.abs(s.children.length - el.children.length) <= 1
    ).length >= 3;
  },
  analyze: (el) => {
    const heading = el.querySelector('h2, h3, h4, h5');
    const image = el.querySelector('img');
    const link = el.querySelector('a');
    const confidence =
      (heading ? 0.3 : 0) + (image ? 0.2 : 0) + (link ? 0.2 : 0) + 0.3;
    return { type: 'card', confidence, state: {} };
  },
};

// Multi-step Flow Detection
const flowDetectorRule: ComponentDetectionRule = {
  type: 'form-wizard',
  priority: 700,
  precheck: (el) => {
    // Look for step indicators: "Step X of Y", progress bars, breadcrumbs with numbers
    const text = el.textContent ?? '';
    return /step\s+\d+\s+(of|\/)\s+\d+/i.test(text) ||
           el.querySelector('[role="progressbar"]') !== null ||
           el.querySelector('.step, .wizard-step, [data-step]') !== null;
  },
  analyze: (el) => {
    // Extract step info from various patterns
    const stepMatch = (el.textContent ?? '').match(/step\s+(\d+)\s+(?:of|\/)\s+(\d+)/i);
    const progressBar = el.querySelector('[role="progressbar"]');
    const stepElements = el.querySelectorAll('.step, [data-step], [role="tab"]');

    let currentStep = 1, totalSteps = 1;
    if (stepMatch) {
      currentStep = parseInt(stepMatch[1], 10);
      totalSteps = parseInt(stepMatch[2], 10);
    } else if (progressBar) {
      const value = parseFloat(progressBar.getAttribute('aria-valuenow') ?? '0');
      const max = parseFloat(progressBar.getAttribute('aria-valuemax') ?? '100');
      totalSteps = stepElements.length || Math.round(max / 25);
      currentStep = Math.round((value / max) * totalSteps);
    }

    return {
      type: 'form-wizard',
      confidence: 0.8,
      state: { currentStep, totalSteps },
    };
  },
};
```

### III.3 Error State Detection

```typescript
// packages/core/src/intelligence/error-detector.ts

/**
 * Detects error states visible on the page through multiple signals:
 * 1. ARIA: aria-invalid, role="alert", aria-errormessage
 * 2. CSS: red text (hsl hue 0-15, saturation > 50%), error class names
 * 3. Content: "error", "failed", "invalid" text patterns
 * 4. Toast/notification detection (high z-index, role="status")
 * 5. HTTP error pages (status codes in title/h1)
 */

class ErrorDetector {
  private static readonly ERROR_CLASS_PATTERNS = [
    /\berr(or)?\b/i, /\binvalid\b/i, /\balert\b/i,
    /\bdanger\b/i, /\bfail(ed|ure)?\b/i, /\bwarning\b/i,
  ];

  private static readonly ERROR_TEXT_PATTERNS = [
    /error\s*[:!]/i, /failed\s+to/i, /something\s+went\s+wrong/i,
    /please\s+try\s+again/i, /not\s+found/i, /access\s+denied/i,
    /unauthorized/i, /forbidden/i, /timed?\s*out/i,
  ];

  detect(root: Element): PageErrorState[] {
    return [
      ...this.detectAriaErrors(root),
      ...this.detectVisualErrors(root),
      ...this.detectToastErrors(root),
      ...this.detectBannerErrors(root),
      ...this.detectHTTPErrors(),
    ];
  }

  private detectVisualErrors(root: Element): PageErrorState[] {
    const errors: PageErrorState[] = [];
    // Scan elements with red-ish computed color
    const candidates = root.querySelectorAll('*');
    for (const el of candidates) {
      const style = getComputedStyle(el);
      const color = this.parseColor(style.color);
      if (color && this.isErrorColor(color)) {
        const text = el.textContent?.trim() ?? '';
        if (text.length > 0 && text.length < 200) {
          const matchesPattern = ErrorDetector.ERROR_TEXT_PATTERNS
            .some(p => p.test(text));
          if (matchesPattern) {
            errors.push({
              type: 'inline-error',
              message: text,
              selector: buildSelector(el),
              severity: 'error',
              dismissible: false,
            });
          }
        }
      }
    }
    return errors;
  }

  private isErrorColor(rgb: { r: number; g: number; b: number }): boolean {
    // Red-ish: high R, low G and B
    return rgb.r > 180 && rgb.g < 100 && rgb.b < 100;
  }
}
```

### III.4 Shadow DOM & iframe Support

```typescript
// packages/core/src/intelligence/cross-boundary-scanner.ts

/**
 * Pierces Shadow DOM and same-origin iframes to build a unified page model.
 *
 * Shadow DOM strategy:
 * - Open shadows: traverse via element.shadowRoot
 * - Closed shadows: skip (cannot access by design)
 * - Slotted content: follow <slot> assignments
 *
 * iframe strategy:
 * - Same-origin: access contentDocument, merge into parent model
 * - Cross-origin: mark as opaque boundary, extract title/src only
 * - Sandboxed: respect sandbox attribute restrictions
 */

class CrossBoundaryScanner {
  scanWithShadowDOM(root: Element, depth: number = 0): ScanResult {
    const results: ScanResult = { sections: [], elements: [] };

    // Walk light DOM
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();

    while (node) {
      const el = node as Element;

      // Pierce open shadow roots
      if (el.shadowRoot) {
        const shadowResults = this.scanWithShadowDOM(el.shadowRoot as unknown as Element, depth + 1);
        results.sections.push(...shadowResults.sections);
        results.elements.push(...shadowResults.elements);
      }

      // Follow slotted content
      if (el.tagName === 'SLOT') {
        const slot = el as HTMLSlotElement;
        for (const assigned of slot.assignedElements()) {
          const slotResults = this.scanWithShadowDOM(assigned, depth);
          results.sections.push(...slotResults.sections);
          results.elements.push(...slotResults.elements);
        }
      }

      node = walker.nextNode();
    }

    return results;
  }

  scanIframes(root: Element): IframeScanResult[] {
    const iframes = root.querySelectorAll('iframe');
    const results: IframeScanResult[] = [];

    for (const iframe of iframes) {
      try {
        const doc = (iframe as HTMLIFrameElement).contentDocument;
        if (doc) {
          // Same-origin: full scan
          const model = this.scanWithShadowDOM(doc.body);
          results.push({
            src: iframe.getAttribute('src') ?? '',
            origin: 'same-origin',
            model,
          });
        }
      } catch {
        // Cross-origin: extract metadata only
        results.push({
          src: iframe.getAttribute('src') ?? '',
          origin: 'cross-origin',
          title: iframe.getAttribute('title') ?? '',
        });
      }
    }

    return results;
  }
}
```

---

## IV. PHASE 2 — COGNITIVE ENGINE (Agentic LLM Architecture)

**Owner**: *llm + *lead
**Impact**: Transforms from simple Q&A to intelligent multi-step reasoning

### IV.1 ReAct Agent Loop

The current `ToolExecutor` runs a simple loop: call LLM → execute tools → repeat.
The new `CognitiveEngine` implements a full **ReAct (Reason + Act)** pattern with a planning phase.

```typescript
// packages/core/src/cognitive/engine.ts

/**
 * CognitiveEngine — The brain of GuideKit v2.
 *
 * Implements a Plan → Reason → Act → Observe loop:
 *
 *   User Query
 *       │
 *       ▼
 *   ┌──────────┐    "Is this simple or complex?"
 *   │  Router   │──── Simple → Direct LLM call (fast path)
 *   └────┬─────┘
 *        │ Complex
 *        ▼
 *   ┌──────────┐    "What steps do I need?"
 *   │  Planner │──── Decompose into subtasks
 *   └────┬─────┘
 *        │ Plan
 *        ▼
 *   ┌──────────┐    "What do I know? What do I need?"
 *   │  Reasoner│──── Gather context, check knowledge base
 *   └────┬─────┘
 *        │ Enriched context
 *        ▼
 *   ┌──────────┐    "Execute the next action"
 *   │  Executor│──── Call tools, validate results
 *   └────┬─────┘
 *        │ Results
 *        ▼
 *   ┌──────────┐    "Did that work? What's next?"
 *   │  Observer│──── Validate, update plan, loop or finish
 *   └────┬─────┘
 *        │
 *        ▼
 *   Response (streamed with citations)
 */

interface CognitiveEngineConfig {
  /** Model router configuration */
  routing: ModelRoutingConfig;
  /** Maximum planning depth for complex queries */
  maxPlanDepth: number;
  /** Maximum total LLM calls per user query */
  maxTotalCalls: number;
  /** Confidence threshold below which to escalate or ask for clarification */
  confidenceThreshold: number;
  /** Enable hallucination guard (validates claims against page model) */
  hallucinationGuard: boolean;
}

interface ExecutionPlan {
  id: string;
  query: string;
  complexity: 'simple' | 'moderate' | 'complex';
  steps: PlanStep[];
  currentStep: number;
  status: 'planning' | 'executing' | 'observing' | 'complete' | 'failed';
}

interface PlanStep {
  id: string;
  description: string;
  type: 'retrieve' | 'analyze' | 'act' | 'respond';
  tools: string[];
  dependencies: string[]; // step IDs that must complete first
  status: 'pending' | 'running' | 'complete' | 'failed';
  result?: unknown;
}

class CognitiveEngine {
  private readonly router: ModelRouter;
  private readonly planner: QueryPlanner;
  private readonly reasoner: ContextReasoner;
  private readonly executor: EnhancedToolExecutor;
  private readonly observer: ResultObserver;
  private readonly guard: HallucinationGuard;
  private readonly middleware: MiddlewarePipeline;

  async *process(
    query: string,
    context: CognitiveContext,
    signal?: AbortSignal,
  ): AsyncGenerator<CognitiveChunk, CognitiveResult> {
    // 1. Route: determine complexity and select model
    const route = await this.router.classify(query, context);

    yield { type: 'status', status: 'thinking', detail: route.complexity };

    // 2. Fast path for simple queries
    if (route.complexity === 'simple') {
      return yield* this.directResponse(query, context, route, signal);
    }

    // 3. Plan: decompose complex query into steps
    const plan = await this.planner.createPlan(query, context, route);
    yield { type: 'plan', plan };

    // 4. Execute plan steps
    for (const step of this.topologicalSort(plan.steps)) {
      if (signal?.aborted) break;

      // Check dependencies
      const deps = step.dependencies.map(id =>
        plan.steps.find(s => s.id === id)
      );
      if (deps.some(d => d?.status === 'failed')) {
        step.status = 'failed';
        continue;
      }

      step.status = 'running';
      yield { type: 'step-start', stepId: step.id, description: step.description };

      // Reason: enrich context with knowledge retrieval
      const enrichedContext = await this.reasoner.enrich(
        step, context, plan,
      );

      // Act: execute tools for this step
      const result = await this.executor.executeStep(
        step, enrichedContext, route.model, signal,
      );

      // Observe: validate result, update plan
      const observation = await this.observer.evaluate(
        step, result, context,
      );

      step.result = observation.result;
      step.status = observation.success ? 'complete' : 'failed';

      yield { type: 'step-complete', stepId: step.id, observation };

      // Dynamic re-planning if observation suggests course correction
      if (observation.replanSuggestion) {
        const updatedSteps = await this.planner.replan(
          plan, observation.replanSuggestion, context,
        );
        plan.steps.push(...updatedSteps);
        yield { type: 'replan', newSteps: updatedSteps };
      }
    }

    // 5. Synthesize final response from all step results
    const synthesis = this.reasoner.synthesize(plan, context);
    let fullText = '';

    for await (const chunk of synthesis) {
      fullText += chunk.text;
      yield { type: 'text', text: chunk.text, sources: chunk.sources };
    }

    // 6. Hallucination guard: validate claims against page model
    if (this.guard) {
      const validation = await this.guard.validate(
        fullText, context.pageModel,
      );
      if (validation.issues.length > 0) {
        yield { type: 'validation', issues: validation.issues };
      }
    }

    return {
      text: fullText,
      plan,
      confidence: this.calculateConfidence(plan),
      sources: this.collectSources(plan),
      usage: this.aggregateUsage(plan),
    };
  }
}
```

### IV.2 Model Router

```typescript
// packages/core/src/cognitive/model-router.ts

/**
 * Intelligently routes queries to the optimal model based on:
 * - Query complexity (simple factual → complex reasoning)
 * - Cost budget (use cheap models when possible)
 * - Latency requirements (voice mode needs fast responses)
 * - Capability requirements (tool use, long context, vision)
 *
 * Strategy:
 *   "Where is the checkout button?" → Fast model (Gemini Flash / GPT-4o-mini)
 *   "Walk me through the signup flow" → Capable model (Gemini Pro / GPT-4o)
 *   "Why is my form not submitting?" → Reasoning model (needs page analysis)
 */

interface ModelRoutingConfig {
  /** Primary model for complex queries */
  primary: ModelSpec;
  /** Fast model for simple queries (optional, falls back to primary) */
  fast?: ModelSpec;
  /** Fallback chain: if primary fails, try these in order */
  fallbacks?: ModelSpec[];
  /** Cost budget per session (USD) */
  costBudgetPerSession?: number;
  /** Latency target in ms (auto-selects faster model if exceeded) */
  latencyTargetMs?: number;
}

interface ModelSpec {
  provider: string;
  model: string;
  /** Approximate cost per 1K tokens (input) */
  inputCostPer1K: number;
  /** Approximate cost per 1K tokens (output) */
  outputCostPer1K: number;
  /** Max context window tokens */
  maxContextTokens: number;
  /** Supports tool/function calling */
  supportsTools: boolean;
  /** Supports structured output (JSON mode) */
  supportsStructuredOutput: boolean;
}

class ModelRouter {
  private sessionCostAccumulator = 0;

  async classify(query: string, context: CognitiveContext): Promise<RouteDecision> {
    // Heuristic classification (no LLM call needed)
    const complexity = this.estimateComplexity(query, context);
    const model = this.selectModel(complexity, context);

    return { complexity, model, estimatedTokens: this.estimateTokens(query, context) };
  }

  private estimateComplexity(query: string, ctx: CognitiveContext): 'simple' | 'moderate' | 'complex' {
    const signals = {
      wordCount: query.split(/\s+/).length,
      hasMultipleQuestions: (query.match(/\?/g) ?? []).length > 1,
      referencesMultipleSections: this.countSectionReferences(query, ctx) > 2,
      requiresNavigation: /navigate|go to|take me|show me|find/i.test(query),
      requiresExplanation: /explain|how|why|what does|walk.*through/i.test(query),
      requiresComparison: /compare|difference|vs|between/i.test(query),
      isFollowUp: ctx.conversationHistory.length > 2,
      pageHasErrors: ctx.pageModel.errorStates.length > 0,
    };

    let score = 0;
    if (signals.wordCount > 20) score += 1;
    if (signals.hasMultipleQuestions) score += 2;
    if (signals.referencesMultipleSections) score += 1;
    if (signals.requiresExplanation) score += 1;
    if (signals.requiresComparison) score += 2;
    if (signals.requiresNavigation && signals.requiresExplanation) score += 1;

    if (score <= 1) return 'simple';
    if (score <= 3) return 'moderate';
    return 'complex';
  }

  private selectModel(complexity: string, ctx: CognitiveContext): ModelSpec {
    // Voice mode: always prefer fast model for latency
    if (ctx.isVoiceMode && this.config.fast) return this.config.fast;

    // Budget check: if near limit, downgrade
    if (this.config.costBudgetPerSession &&
        this.sessionCostAccumulator > this.config.costBudgetPerSession * 0.8) {
      return this.config.fast ?? this.config.primary;
    }

    // Complexity routing
    if (complexity === 'simple' && this.config.fast) return this.config.fast;
    return this.config.primary;
  }
}
```

### IV.3 Hallucination Guard

```typescript
// packages/core/src/cognitive/hallucination-guard.ts

/**
 * Validates LLM claims against the ground truth of the page model.
 *
 * Checks:
 * 1. Element existence: "Click the Submit button" → does a Submit button exist?
 * 2. State accuracy: "The form has errors" → does the form actually have errors?
 * 3. Navigation claims: "Go to Settings" → does a Settings nav item exist?
 * 4. Content claims: "The price is $99" → is $99 visible on the page?
 * 5. Capability claims: "You can upload files" → is there a file input?
 */

class HallucinationGuard {
  validate(response: string, pageModel: SemanticPageModel): ValidationResult {
    const issues: ValidationIssue[] = [];

    // Extract claims from response
    const claims = this.extractClaims(response);

    for (const claim of claims) {
      switch (claim.type) {
        case 'element-reference':
          if (!this.elementExists(claim.selector, pageModel)) {
            issues.push({
              type: 'nonexistent-element',
              claim: claim.text,
              severity: 'high',
              suggestion: `Element "${claim.selector}" not found on page`,
            });
          }
          break;

        case 'navigation-reference':
          if (!this.navItemExists(claim.target, pageModel)) {
            issues.push({
              type: 'nonexistent-navigation',
              claim: claim.text,
              severity: 'medium',
              suggestion: `Navigation item "${claim.target}" not found`,
            });
          }
          break;

        case 'content-claim':
          if (!this.contentExists(claim.content, pageModel)) {
            issues.push({
              type: 'unverifiable-content',
              claim: claim.text,
              severity: 'low',
              suggestion: `Content "${claim.content}" not found on visible page`,
            });
          }
          break;
      }
    }

    return {
      isValid: issues.filter(i => i.severity === 'high').length === 0,
      issues,
      confidence: 1 - (issues.length * 0.15), // Degrade confidence per issue
    };
  }
}
```

### IV.4 Confidence Scoring

```typescript
// packages/core/src/cognitive/confidence-scorer.ts

/**
 * Multi-signal confidence scoring for every response.
 *
 * Signals:
 * 1. Context coverage: % of query tokens that appear in context
 * 2. Tool success rate: % of tool calls that succeeded
 * 3. Hallucination score: inverse of guard issues
 * 4. Model self-reported confidence (if available)
 * 5. Knowledge retrieval relevance (cosine similarity)
 * 6. Conversation coherence (does response follow from history?)
 */

interface ConfidenceBreakdown {
  overall: number; // 0-1
  contextCoverage: number;
  toolSuccessRate: number;
  hallucinationScore: number;
  retrievalRelevance: number;
  /** If below threshold, response includes a disclaimer */
  belowThreshold: boolean;
}
```

---

## V. PHASE 3 — KNOWLEDGE LAYER (RAG Pipeline)

**Owner**: *llm + *experience
**Impact**: Allows developers to inject domain knowledge for accurate, grounded guidance

### V.1 Architecture

```typescript
// packages/core/src/knowledge/index.ts

/**
 * In-browser RAG pipeline:
 *
 *   Developer Knowledge Base          Runtime Query
 *         │                                │
 *         ▼                                ▼
 *   ┌──────────────┐              ┌──────────────┐
 *   │  Chunker     │              │  Embedder    │
 *   │  (paragraph/ │              │  (same model)│
 *   │   section)   │              └──────┬───────┘
 *   └──────┬───────┘                     │
 *          │                             │
 *          ▼                             ▼
 *   ┌──────────────┐              ┌──────────────┐
 *   │  Embedder    │              │  Vector      │
 *   │  (in-browser │              │  Search      │
 *   │   ONNX)      │              │  (cosine)    │
 *   └──────┬───────┘              └──────┬───────┘
 *          │                             │
 *          ▼                             │
 *   ┌──────────────┐                    │
 *   │  IndexedDB   │◄───────────────────┘
 *   │  VectorStore │
 *   └──────────────┘
 *          │
 *          ▼
 *   ┌──────────────────────────────────────┐
 *   │  Hybrid Ranker                       │
 *   │  (semantic similarity + BM25 keyword │
 *   │   + recency + section match)         │
 *   └──────────────────┬───────────────────┘
 *                      │
 *                      ▼
 *              Top-K chunks with
 *              source attribution
 */

interface KnowledgeBaseConfig {
  /** Documents to ingest (markdown, plain text, HTML) */
  documents?: KnowledgeDocument[];
  /** URL endpoints that return knowledge documents */
  documentUrls?: string[];
  /** Async function to fetch documents on demand */
  documentLoader?: () => Promise<KnowledgeDocument[]>;
  /** Embedding model (default: all-MiniLM-L6-v2 ONNX) */
  embeddingModel?: string;
  /** Maximum chunks to retrieve per query */
  topK?: number;
  /** Minimum similarity threshold (0-1) */
  minSimilarity?: number;
  /** Enable keyword fallback when semantic search returns low confidence */
  hybridSearch?: boolean;
}

interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  /** Content type for parsing */
  type: 'markdown' | 'text' | 'html';
  /** Metadata for filtering and attribution */
  metadata?: {
    category?: string;
    tags?: string[];
    url?: string;
    lastUpdated?: string;
    /** Restrict this doc to specific page URL patterns */
    pagePatterns?: string[];
  };
}

interface RetrievalResult {
  chunks: RetrievedChunk[];
  query: string;
  searchType: 'semantic' | 'keyword' | 'hybrid';
  totalDocumentsSearched: number;
}

interface RetrievedChunk {
  documentId: string;
  documentTitle: string;
  content: string;
  /** Cosine similarity to query (0-1) */
  similarity: number;
  /** BM25 keyword relevance score */
  keywordScore: number;
  /** Combined ranking score */
  combinedScore: number;
  /** Source attribution for citation */
  source: {
    documentTitle: string;
    section?: string;
    url?: string;
    pageNumber?: number;
  };
}
```

### V.2 In-Browser Embedding Engine

```typescript
// packages/core/src/knowledge/embedding-engine.ts

/**
 * Runs sentence embeddings directly in the browser via ONNX Runtime Web.
 * Uses all-MiniLM-L6-v2 (22MB ONNX model, 384-dim embeddings).
 *
 * Features:
 * - Cache API persistence (same as VAD model)
 * - Batched inference for document ingestion
 * - Web Worker offloading to avoid blocking main thread
 * - Quantized model option (INT8, 6MB) for mobile
 */

class EmbeddingEngine {
  private session: ort.InferenceSession | null = null;
  private tokenizer: BPETokenizer | null = null;

  async init(): Promise<void> {
    // Load model from Cache API or CDN
    const modelUrl = this.config.embeddingModel ??
      'https://cdn.jsdelivr.net/npm/@guidekit/models/minilm-l6-v2.onnx';

    const modelBuffer = await this.loadWithCache(modelUrl);
    this.session = await ort.InferenceSession.create(modelBuffer);
    this.tokenizer = await BPETokenizer.load(/* vocab URL */);
  }

  /** Embed a single query string. Returns 384-dim float32 vector. */
  async embed(text: string): Promise<Float32Array> {
    const tokens = this.tokenizer!.encode(text);
    const inputIds = new ort.Tensor('int64', BigInt64Array.from(tokens.map(BigInt)), [1, tokens.length]);
    const attentionMask = new ort.Tensor('int64', BigInt64Array.from(tokens.map(() => 1n)), [1, tokens.length]);

    const output = await this.session!.run({
      input_ids: inputIds,
      attention_mask: attentionMask,
    });

    // Mean pooling over token embeddings
    return this.meanPool(output['last_hidden_state'] as ort.Tensor, tokens.length);
  }

  /** Batch embed multiple texts (for document ingestion). */
  async embedBatch(texts: string[], batchSize = 32): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const embeddings = await Promise.all(batch.map(t => this.embed(t)));
      results.push(...embeddings);
    }
    return results;
  }
}
```

### V.3 Vector Store (IndexedDB)

```typescript
// packages/core/src/knowledge/vector-store.ts

/**
 * Persistent vector store backed by IndexedDB.
 *
 * Schema:
 *   documents: { id, title, metadata, chunkedAt }
 *   chunks: { id, documentId, content, embedding (Float32Array), metadata }
 *   index: { version, dimensions, totalChunks }
 *
 * Search: brute-force cosine similarity (fast enough for <10K chunks).
 * For larger knowledge bases, use approximate nearest neighbor (HNSW).
 */

class VectorStore {
  private db: IDBDatabase | null = null;

  async search(queryEmbedding: Float32Array, topK: number): Promise<SearchResult[]> {
    const chunks = await this.getAllChunks();
    const scored = chunks.map(chunk => ({
      ...chunk,
      similarity: this.cosineSimilarity(queryEmbedding, chunk.embedding),
    }));

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, topK);
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
```

---

## VI. PHASE 4 — TOKEN-AWARE CONTEXT PIPELINE

**Owner**: *lead + *llm
**Impact**: Fixes the character-based budget, enables intelligent context management

### VI.1 Real Tokenizer Integration

```typescript
// packages/core/src/context/tokenizer.ts

/**
 * Provider-aware tokenizer that counts REAL tokens, not characters.
 *
 * Strategy:
 * - Gemini: Use the countTokens API endpoint (1 HTTP call, cached)
 * - OpenAI/Anthropic: Use js-tiktoken (cl100k_base / claude tokenizer)
 * - Fallback: 1 token ≈ 4 characters (English), 1 token ≈ 1.5 chars (CJK)
 *
 * The tokenizer is lazy-loaded and cached per provider.
 */

interface TokenBudget {
  /** Total tokens available for system prompt + history + response */
  total: number;
  /** Reserved for system prompt (page model + instructions) */
  systemPrompt: number;
  /** Reserved for conversation history */
  history: number;
  /** Reserved for LLM response */
  response: number;
  /** Reserved for tool definitions */
  tools: number;
  /** Currently used */
  used: {
    systemPrompt: number;
    history: number;
    tools: number;
  };
  /** Remaining budget for response */
  remainingForResponse: number;
}

class TokenAwareBudgetManager {
  private tokenizer: Tokenizer;

  constructor(provider: string, modelMaxTokens: number) {
    this.tokenizer = TokenizerFactory.create(provider);
    this.modelMaxTokens = modelMaxTokens;
  }

  /** Allocate token budget across prompt components. */
  allocate(components: {
    systemPromptDraft: string;
    history: ConversationTurn[];
    tools: ToolDefinition[];
  }): TokenBudget {
    const toolTokens = this.tokenizer.count(JSON.stringify(components.tools));
    const historyTokens = this.tokenizer.count(
      components.history.map(t => t.content).join('\n'),
    );
    const systemTokens = this.tokenizer.count(components.systemPromptDraft);

    const totalUsed = toolTokens + historyTokens + systemTokens;
    const responseReserve = Math.min(
      Math.floor(this.modelMaxTokens * 0.25), // 25% for response
      4096, // Cap at 4K tokens for response
    );

    return {
      total: this.modelMaxTokens,
      systemPrompt: systemTokens,
      history: historyTokens,
      response: responseReserve,
      tools: toolTokens,
      used: { systemPrompt: systemTokens, history: historyTokens, tools: toolTokens },
      remainingForResponse: this.modelMaxTokens - totalUsed,
    };
  }

  /** Compress context to fit within budget. */
  compress(budget: TokenBudget, context: ContextComponents): ContextComponents {
    if (budget.remainingForResponse >= budget.response) {
      return context; // Fits fine
    }

    // Progressive compression strategies:
    // 1. Truncate oldest conversation turns
    // 2. Summarize page sections (keep labels, drop summaries)
    // 3. Drop low-priority interactive elements
    // 4. Compress tool descriptions
    // 5. If still over, use LLM to summarize conversation
    return this.applyCompressionStrategies(budget, context);
  }
}
```

### VI.2 Tiered Memory System

```typescript
// packages/core/src/context/memory.ts

/**
 * Three-tier memory system:
 *
 * 1. Working Memory (current turn)
 *    - Current query, active tool results, page model delta
 *    - Lifetime: single turn
 *    - Storage: in-memory
 *
 * 2. Session Memory (conversation)
 *    - Conversation history with intelligent summarization
 *    - User preferences learned during session
 *    - Visited pages and actions taken
 *    - Lifetime: browser session (survives navigation)
 *    - Storage: sessionStorage
 *
 * 3. Persistent Memory (cross-session)
 *    - User profile (name, role, preferences — if consented)
 *    - Frequently asked topics
 *    - Completed onboarding/tour state
 *    - Lifetime: permanent (until cleared)
 *    - Storage: IndexedDB (encrypted)
 */

interface TieredMemory {
  working: WorkingMemory;
  session: SessionMemory;
  persistent: PersistentMemory;
}

interface WorkingMemory {
  currentQuery: string;
  activeToolResults: ToolCallRecord[];
  pageModelDelta: Partial<SemanticPageModel>; // Only changed fields since last turn
  retrievedKnowledge: RetrievedChunk[];
  activePlan: ExecutionPlan | null;
}

interface SessionMemory {
  history: ConversationTurn[];
  /** LLM-generated summary of conversation so far */
  conversationSummary: string;
  /** Pages visited during this session */
  pageTrail: Array<{ url: string; title: string; timestamp: number; durationMs: number }>;
  /** Actions performed by the agent */
  actionLog: Array<{ action: string; target: string; timestamp: number; success: boolean }>;
  /** Topics discussed (extracted by LLM) */
  topicsDiscussed: string[];
  /** User preferences detected during conversation */
  inferredPreferences: {
    verbosity: 'concise' | 'detailed';
    technicalLevel: 'beginner' | 'intermediate' | 'expert';
    preferredLanguage: string;
  };
}

interface PersistentMemory {
  /** User profile (only stored with explicit consent) */
  userProfile?: {
    name?: string;
    role?: string;
    department?: string;
  };
  /** Completed tours/onboarding flows */
  completedFlows: string[];
  /** Frequently asked topics (for proactive suggestions) */
  frequentTopics: Array<{ topic: string; count: number; lastAsked: number }>;
  /** Custom preferences set by user */
  preferences: Record<string, unknown>;
}
```

---

## VII. PHASE 5 — PLUGIN & MIDDLEWARE ARCHITECTURE

**Owner**: *lead + *infra
**Impact**: Makes GuideKit infinitely extensible

### VII.1 Plugin System

```typescript
// packages/core/src/plugins/index.ts

/**
 * Plugin system with typed lifecycle hooks.
 *
 * Plugins can:
 * - Add new tools (e.g., analytics, CRM integration)
 * - Add middleware (intercept/transform at any pipeline stage)
 * - Add custom renderers (new response types)
 * - Add providers (custom LLM/STT/TTS backends)
 * - Add detection rules (new component types)
 * - Access all core subsystems via the plugin context
 */

interface GuideKitPlugin {
  /** Unique plugin identifier */
  name: string;
  /** Semver version */
  version: string;
  /** Dependencies on other plugins */
  dependencies?: string[];

  /** Called when the plugin is registered */
  install(context: PluginContext): void | Promise<void>;
  /** Called when GuideKit is destroyed */
  destroy?(): void | Promise<void>;
}

interface PluginContext {
  /** Register tools that the LLM can call */
  registerTool(definition: ToolDefinition, handler: ToolHandler): void;
  /** Register middleware at a specific pipeline stage */
  use(stage: MiddlewareStage, handler: MiddlewareHandler): void;
  /** Register a custom component detection rule */
  registerComponentRule(rule: ComponentDetectionRule): void;
  /** Register a custom response renderer */
  registerRenderer(type: string, renderer: ResponseRenderer): void;
  /** Access the event bus for inter-plugin communication */
  bus: EventBus;
  /** Access the knowledge layer */
  knowledge: KnowledgeBase;
  /** Access current page model */
  getPageModel(): SemanticPageModel;
  /** Access conversation history */
  getHistory(): ConversationTurn[];
  /** Access persistent memory */
  getMemory(): PersistentMemory;
  /** Logger scoped to this plugin */
  log: ScopedLogger;
}

// Example plugin: Analytics Integration
const analyticsPlugin: GuideKitPlugin = {
  name: '@guidekit/plugin-analytics',
  version: '1.0.0',

  install(ctx) {
    // Register a tool the LLM can call
    ctx.registerTool(
      {
        name: 'trackEvent',
        description: 'Track a user analytics event (e.g., when user completes a guided action)',
        parameters: {
          event: { type: 'string', description: 'Event name' },
          properties: { type: 'object', description: 'Event properties' },
        },
        required: ['event'],
        schemaVersion: 1,
      },
      {
        name: 'trackEvent',
        execute: async (args) => {
          window.analytics?.track(args.event as string, args.properties as Record<string, unknown>);
          return { tracked: true };
        },
      },
    );

    // Add middleware to log all responses
    ctx.use('after:llm', async (context, next) => {
      const result = await next(context);
      window.analytics?.track('guidekit_response', {
        query: context.query,
        responseLength: result.text.length,
        toolsUsed: result.toolCallsExecuted.length,
        confidence: result.confidence,
      });
      return result;
    });
  },
};
```

### VII.2 Middleware Pipeline

```typescript
// packages/core/src/plugins/middleware.ts

/**
 * Koa-style middleware pipeline with typed stages.
 *
 * Stages (in execution order):
 * 1. before:scan    — Modify scan parameters, add custom scanning
 * 2. after:scan     — Transform/enrich the page model
 * 3. before:retrieve — Modify RAG query, add filters
 * 4. after:retrieve  — Transform/filter retrieved chunks
 * 5. before:llm     — Modify system prompt, inject context, filter tools
 * 6. after:llm      — Transform response, add metadata, validate
 * 7. before:tool    — Validate tool args, add logging, rate-limit
 * 8. after:tool     — Transform tool results, add side effects
 * 9. before:render  — Transform content before UI rendering
 * 10. after:render  — Post-render hooks (analytics, a11y checks)
 */

type MiddlewareStage =
  | 'before:scan' | 'after:scan'
  | 'before:retrieve' | 'after:retrieve'
  | 'before:llm' | 'after:llm'
  | 'before:tool' | 'after:tool'
  | 'before:render' | 'after:render';

type MiddlewareHandler = (
  context: MiddlewareContext,
  next: (ctx: MiddlewareContext) => Promise<MiddlewareContext>,
) => Promise<MiddlewareContext>;

class MiddlewarePipeline {
  private stacks = new Map<MiddlewareStage, MiddlewareHandler[]>();

  use(stage: MiddlewareStage, handler: MiddlewareHandler): void {
    const stack = this.stacks.get(stage) ?? [];
    stack.push(handler);
    this.stacks.set(stage, stack);
  }

  async execute(stage: MiddlewareStage, context: MiddlewareContext): Promise<MiddlewareContext> {
    const stack = this.stacks.get(stage) ?? [];
    if (stack.length === 0) return context;

    // Compose middleware (Koa-style)
    let index = -1;
    const dispatch = async (i: number, ctx: MiddlewareContext): Promise<MiddlewareContext> => {
      if (i <= index) throw new Error('next() called multiple times');
      index = i;
      if (i >= stack.length) return ctx;
      return stack[i](ctx, (c) => dispatch(i + 1, c));
    };

    return dispatch(0, context);
  }
}
```

---

## VIII. PHASE 6 — RICH PRESENTATION LAYER

**Owner**: *ui
**Impact**: Transforms plain text responses into rich, interactive experiences

### VIII.1 Markdown Renderer

```typescript
// packages/core/src/rendering/markdown-renderer.ts

/**
 * Secure markdown renderer for LLM responses.
 *
 * Supported elements:
 * - **Bold**, *italic*, ~~strikethrough~~
 * - `inline code` and fenced code blocks with syntax highlighting
 * - Ordered and unordered lists (nested)
 * - [Links](url) — opened in new tab with rel="noopener"
 * - Tables (GFM)
 * - Blockquotes
 * - Headings (h3-h6 only — h1/h2 reserved for page)
 * - Images (with alt text validation)
 *
 * Security:
 * - All HTML stripped (no raw HTML passthrough)
 * - URLs validated (https only, no javascript:)
 * - XSS prevention via textContent (never innerHTML for user data)
 * - CSP-compatible (no inline styles from user content)
 */
```

### VIII.2 Adaptive Cards

```typescript
// packages/core/src/rendering/adaptive-cards.ts

/**
 * Structured response cards that go beyond text.
 *
 * The LLM can return structured responses via a special tool:
 *   renderCard({ type: 'action-list', items: [...] })
 *
 * Card types:
 * - action-list: Clickable options (e.g., "Do you want to: [A] [B] [C]?")
 * - info-card: Title + description + optional image + CTA
 * - step-list: Numbered steps with completion state
 * - comparison: Side-by-side comparison table
 * - code-snippet: Syntax-highlighted code with copy button
 * - form-helper: Pre-filled form values with "Apply" button
 */

interface AdaptiveCard {
  type: 'action-list' | 'info-card' | 'step-list' | 'comparison'
      | 'code-snippet' | 'form-helper';
  data: Record<string, unknown>;
}
```

### VIII.3 Theme Engine

```typescript
// packages/core/src/rendering/theme-engine.ts

/**
 * Full theming system with semantic design tokens.
 *
 * Three layers:
 * 1. Primitive tokens: Raw values (colors, sizes, fonts)
 * 2. Semantic tokens: Mapped meanings (primary, error, surface)
 * 3. Component tokens: Per-component overrides (fab.bg, panel.radius)
 *
 * Features:
 * - prefers-color-scheme auto-detection (light/dark)
 * - High contrast mode support
 * - Custom CSS property injection into Shadow DOM
 * - Preset themes: default, minimal, glass, corporate
 */

interface ThemeConfig {
  /** Base preset to extend */
  preset?: 'default' | 'minimal' | 'glass' | 'corporate';
  /** Color scheme: auto-detect, force light, or force dark */
  colorScheme?: 'auto' | 'light' | 'dark';
  /** Primitive tokens */
  tokens?: {
    colors?: {
      primary?: string;
      primaryHover?: string;
      secondary?: string;
      surface?: string;
      surfaceElevated?: string;
      text?: string;
      textSecondary?: string;
      textOnPrimary?: string;
      error?: string;
      success?: string;
      warning?: string;
      border?: string;
    };
    typography?: {
      fontFamily?: string;
      fontFamilyMono?: string;
      fontSizeBase?: string;
      fontSizeSmall?: string;
      fontSizeLarge?: string;
      lineHeight?: string;
    };
    spacing?: {
      xs?: string;
      sm?: string;
      md?: string;
      lg?: string;
      xl?: string;
    };
    radii?: {
      sm?: string;
      md?: string;
      lg?: string;
      full?: string;
    };
    shadows?: {
      sm?: string;
      md?: string;
      lg?: string;
    };
  };
  /** Per-component overrides */
  components?: {
    fab?: Partial<FabTokens>;
    panel?: Partial<PanelTokens>;
    message?: Partial<MessageTokens>;
    input?: Partial<InputTokens>;
  };
}
```

---

## IX. PHASE 7 — ENHANCED VOICE PIPELINE

**Owner**: *voice
**Impact**: Makes voice interactions production-grade

### IX.1 Improvements

```typescript
// Key changes to packages/core/src/voice/

/**
 * 1. Shared AudioContext
 *    - VoicePipeline and VAD share a single AudioContext
 *    - Reduces memory footprint by ~50%
 *
 * 2. Phonetic Echo Detection
 *    - Replace word overlap with Soundex/Metaphone comparison
 *    - Window-based with exponential decay
 *    - Adaptive threshold based on environment noise
 *
 * 3. Latency Tracing
 *    - performance.mark() at each pipeline stage
 *    - End-to-end latency reported via EventBus
 *    - Automatic model downgrade if latency exceeds target
 *
 * 4. Offline Recovery
 *    - navigator.onLine detection
 *    - Auto-reconnect STT/TTS WebSockets on network return
 *    - Fallback to Web Speech API when cloud providers unavailable
 *    - Queue user queries during offline, process on reconnect
 *
 * 5. Confidence Filtering
 *    - STT transcripts below 0.7 confidence are held for confirmation
 *    - "Did you say: [transcript]?" prompt for low-confidence inputs
 *
 * 6. Processing Interruption
 *    - User can barge-in during PROCESSING state (not just SPEAKING)
 *    - Aborts in-flight LLM call and restarts listening
 */
```

---

## X. PHASE 8 — INFRASTRUCTURE & QUALITY

**Owner**: *infra + *quality
**Impact**: Enterprise-grade reliability

### X.1 Observability

```typescript
// packages/core/src/observability/telemetry.ts

/**
 * Optional telemetry integration (OpenTelemetry-compatible).
 *
 * Spans:
 * - guidekit.query (root span for each user interaction)
 *   - guidekit.scan (DOM scanning)
 *   - guidekit.retrieve (knowledge retrieval)
 *   - guidekit.plan (query planning)
 *   - guidekit.llm (LLM API call)
 *   - guidekit.tool.{name} (each tool execution)
 *   - guidekit.render (response rendering)
 *
 * Metrics:
 * - guidekit.latency (p50, p95, p99)
 * - guidekit.tokens.used (per provider)
 * - guidekit.cost.accumulated (per session)
 * - guidekit.confidence.distribution
 * - guidekit.tool.success_rate
 * - guidekit.hallucination.rate
 */

interface TelemetryConfig {
  /** Enable telemetry collection */
  enabled: boolean;
  /** Custom exporter (e.g., send to your analytics backend) */
  exporter?: TelemetryExporter;
  /** Sample rate (0-1). Default: 1.0 in dev, 0.1 in production */
  sampleRate?: number;
}
```

### X.2 Security Hardening

```
1. Tool Argument Validation
   - JSON Schema validation before execution
   - Allowlist of executable tool names per session
   - Argument size limits (prevent prompt injection via large payloads)

2. Server-Side Rate Limiting Middleware
   - Export express/next.js middleware
   - Sliding window per session + per IP
   - Token budget enforcement server-side

3. Automated Security Scanning
   - GitHub CodeQL integration
   - Dependabot for dependency vulnerabilities
   - npm audit in CI pipeline

4. Content Security Policy
   - Document CSP requirements for CDN resources (ONNX models, fonts)
   - Nonce-based script loading for IIFE bundle
```

---

## XI. IMPLEMENTATION ROADMAP

### Phase 1: Foundation (Weeks 1-3)
- [ ] Plugin & middleware architecture
- [ ] Token-aware budget manager (real tokenizer)
- [ ] Tool argument JSON Schema validation
- [ ] Exponential backoff with jitter for rate limits
- [ ] Markdown renderer (secure, syntax-highlighted)
- [ ] Dark mode + theme engine
- [ ] Tiered memory system (working + session)

### Phase 2: Intelligence (Weeks 4-6)
- [ ] Component detection engine (8 core patterns)
- [ ] Error state detection
- [ ] Visual hierarchy analysis
- [ ] Flow/wizard state extraction
- [ ] Shadow DOM scanning
- [ ] Enhanced PageModel → SemanticPageModel
- [ ] System prompt templates (composable)

### Phase 3: Cognition (Weeks 7-9)
- [ ] Model router (complexity-based)
- [ ] CognitiveEngine with ReAct loop
- [ ] Query planner (decompose complex queries)
- [ ] Hallucination guard
- [ ] Confidence scoring
- [ ] Source attribution in responses

### Phase 4: Knowledge (Weeks 10-12)
- [ ] In-browser embedding engine (ONNX)
- [ ] IndexedDB vector store
- [ ] Document chunker + ingestion pipeline
- [ ] Hybrid search (semantic + BM25)
- [ ] Knowledge base developer API
- [ ] Persistent memory (IndexedDB, encrypted)

### Phase 5: Voice & Polish (Weeks 13-14)
- [ ] Shared AudioContext
- [ ] Phonetic echo detection
- [ ] Latency tracing (performance.mark)
- [ ] Offline recovery + auto-reconnect
- [ ] STT confidence filtering
- [ ] Processing-state barge-in

### Phase 6: Enterprise (Weeks 15-16)
- [ ] OpenTelemetry integration
- [ ] Server-side rate limiting middleware
- [ ] Security scanning CI pipeline
- [ ] Adaptive cards (6 card types)
- [ ] Tour step-by-step UI
- [ ] Floating UI positioning engine

---

## XII. BUNDLE SIZE STRATEGY

New subsystems must respect bundle limits. Strategy: **tree-shakeable subpath exports**.

```
@guidekit/core                    → 80KB (base: scan + LLM + context)
@guidekit/core/intelligence       → +25KB (component detection, error detection)
@guidekit/core/cognitive          → +15KB (ReAct engine, router, planner)
@guidekit/core/knowledge          → +40KB (embedding engine loaded separately)
@guidekit/core/knowledge/models   → ~22MB (ONNX model, loaded on demand from CDN)
@guidekit/core/telemetry          → +8KB (optional observability)
@guidekit/react                   → 10KB (hooks + widget)
@guidekit/react/markdown          → +12KB (renderer + syntax highlighting)
@guidekit/vanilla                 → 120KB (includes widget CSS)
@guidekit/vad                     → 23KB (Silero ONNX)
@guidekit/server                  → 5KB (JWT + session management)
```

Embedding model and ONNX runtime are loaded on-demand, not bundled.

---

## XIII. DEVELOPER API SURFACE (Final)

```typescript
// What developers see:

import { GuideKitProvider, useGuideKit } from '@guidekit/react';

<GuideKitProvider
  // --- Core (existing) ---
  llm={{ provider: 'gemini', apiKey: '...' }}
  stt={{ provider: 'deepgram', apiKey: '...' }}
  tts={{ provider: 'elevenlabs', apiKey: '...' }}
  agent={{ name: 'Assistant', personality: '...' }}

  // --- NEW: Knowledge Base ---
  knowledge={{
    documents: [
      { id: 'faq', title: 'FAQ', content: faqMarkdown, type: 'markdown' },
      { id: 'docs', title: 'Docs', content: docsContent, type: 'markdown' },
    ],
    topK: 5,
    hybridSearch: true,
  }}

  // --- NEW: Model Routing ---
  routing={{
    primary: { provider: 'gemini', model: 'gemini-2.5-pro' },
    fast: { provider: 'gemini', model: 'gemini-2.5-flash' },
    costBudgetPerSession: 0.50,
  }}

  // --- NEW: Plugins ---
  plugins={[analyticsPlugin, crmPlugin]}

  // --- NEW: Full Theme ---
  theme={{
    preset: 'glass',
    colorScheme: 'auto',
    tokens: {
      colors: { primary: '#6366f1' },
      radii: { md: '12px' },
    },
  }}

  // --- NEW: Cognitive Config ---
  cognitive={{
    hallucinationGuard: true,
    confidenceThreshold: 0.7,
    maxPlanDepth: 3,
  }}

  // --- NEW: Memory ---
  memory={{
    persistent: true,         // Enable cross-session memory (requires consent)
    maxSessionTurns: 50,
    compressionStrategy: 'llm-summarize',
  }}

  // --- NEW: Telemetry ---
  telemetry={{
    enabled: process.env.NODE_ENV === 'production',
    sampleRate: 0.1,
    exporter: myCustomExporter,
  }}
>
  <App />
</GuideKitProvider>
```

---

## XIV. COMPETITIVE POSITIONING

| Capability | GuideKit v2 | Intercom | Zendesk | CommandBar | Chameleon |
|-----------|-------------|----------|---------|-----------|-----------|
| Semantic page understanding | Deep | None | None | Shallow | None |
| Agentic reasoning (ReAct) | Yes | No | No | No | No |
| In-browser RAG | Yes | Server | Server | No | No |
| Multi-provider LLM | 3+ adapters | 1 | 1 | 1 | None |
| Model routing | Automatic | No | No | No | N/A |
| Hallucination guard | Yes | No | No | No | N/A |
| Plugin architecture | Full | Limited | Limited | No | No |
| Voice (STT+TTS+VAD) | Yes | No | No | No | No |
| Self-hosted / no vendor lock | Yes | No | No | No | No |
| Open source | MIT | No | No | No | No |
| Bundle size | <80KB base | SDK heavy | SDK heavy | ~50KB | ~40KB |

---

## XV. LEAD ARCHITECT SIGN-OFF

This blueprint represents the collective analysis of all 8 CARL agents. Every recommendation is grounded in specific code locations from the audit.

**Architecture principle**: Each phase is **independently valuable** and **backwards compatible**. Phase 1 alone (plugins + markdown + dark mode + token budget) elevates GuideKit above every competitor. Phases 2-4 (intelligence + cognition + knowledge) create an entirely new category of SDK.

**Risk mitigation**: Tree-shakeable subpath exports ensure that developers who don't need advanced features pay zero bundle cost. The embedding model (22MB) is loaded on-demand from CDN, not bundled.

**Approved for implementation. Start with Phase 1.**

— *lead (Chief Architect)
