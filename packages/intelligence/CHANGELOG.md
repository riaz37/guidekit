# @guidekit/intelligence

## 3.0.0

### Patch Changes

- 65cab89: Brand assets and docs site SEO (icons, OG image, sitemap, llms.txt). Web Speech STT reliability: silence-based finalization, connect timeout, smarter auto-restart, and non-continuous default to avoid Chrome restart storms. Visual guidance and builtin-tools polish. Widget styling updates. Package metadata for Tier B extensions.
- Updated dependencies [65cab89]
  - @guidekit/core@1.2.0

## 2.0.0

### Patch Changes

- Updated dependencies [e504e76]
  - @guidekit/core@1.1.0

## 1.0.0

### Patch Changes

- Updated dependencies [2b44662]
  - @guidekit/core@1.0.0

## 1.0.0

### Patch Changes

- GuideKit v2 platform: pipeline orchestration, server LLM/voice proxy, cognitive engine, token budgets, platform extensions, telemetry, and a slimmer core facade.
- Updated dependencies
  - @guidekit/core@0.3.0

## 0.1.1

### Patch Changes

- ## v0.2.0

  ### @guidekit/core

  - **fix**: Memory leak — bus subscriptions now properly cleaned up in `destroy()`
  - **fix**: Abort controller reset enables re-initialization after `destroy()`
  - **feat**: Per-tool execution timeouts with configurable `toolTimeoutMs`
  - **feat**: Tool parameter validation via JSON Schema definitions
  - **feat**: Promise-based `WebSocketManager.connect()` with proper timeout rejection
  - **fix**: Web Speech STT/TTS robustness improvements
  - **feat**: Markdown renderer and theme engine enhancements

  ### @guidekit/react

  - **perf**: Shallow comparison in `useGuideKitStatus` prevents unnecessary re-renders
  - **fix**: Shadow root reuse — avoids duplicate `attachShadow` errors
  - **a11y**: Tab focus trapping in widget consent dialog

  ### @guidekit/server

  - **feat**: Session key store TTL with lazy eviction of expired sessions
  - **fix**: Auto-evict expired sessions on lookup

  ### @guidekit/vad

  - **fix**: Test improvements and minor cleanup

  ### Docs

  - Updated getting-started, hooks, privacy, proactive-triggers, server, and voice pages
  - New troubleshooting guide

  ### Tests

  - 6 new test suites: markdown-renderer, theme-engine, deepgram-stt, elevenlabs-tts, web-speech-stt, web-speech-tts

- Updated dependencies
  - @guidekit/core@0.2.0

## 0.1.1

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
