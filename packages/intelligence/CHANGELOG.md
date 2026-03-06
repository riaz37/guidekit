# @guidekit/intelligence

## 1.0.0

### Minor Changes

- feat(intelligence): add @guidekit/intelligence package with semantic page analysis

  - ComponentDetector: ARIA-first UI component detection (tabs, modals, accordions, cards, wizards, etc.)
  - ErrorDetector: page error state detection via ARIA, class patterns, and text heuristics
  - FlowDetector: multi-step flow/wizard detection with step tracking
  - HeadingExtractor: document outline tree builder from h1-h6 elements
  - HallucinationGuard: LLM response validation against actual page state
  - SemanticScanner: orchestrator composing all detectors into SemanticPageModel
  - Added SemanticPageModel, ComponentNode, FlowState, PageErrorState, HeadingNode types to @guidekit/core

### Patch Changes

- Updated dependencies
  - @guidekit/core@0.1.0
