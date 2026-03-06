# @guidekit/core

## 0.1.0

### Minor Changes

- Add streaming responses (`sendTextStream()`), OpenAI and Anthropic LLM adapters, and comprehensive test coverage for VAD, React hooks, and core orchestrator.

  ### Streaming

  - `sendTextStream()` returns `{ stream: AsyncIterable<string>, done: Promise<StreamResult> }` for progressive token rendering
  - `sendText()` now delegates to `sendTextStream()` internally (backward compatible)
  - New `useGuideKitStream()` React hook for streaming state (`isStreaming`, `streamingText`)
  - Widget (React + Vanilla) renders tokens progressively as they arrive

  ### Multi-Provider LLM

  - **OpenAI adapter** — supports GPT-4o and all OpenAI-compatible APIs via `baseUrl` (Azure, Mistral, DeepSeek, Groq, Together AI, OpenRouter)
  - **Anthropic adapter** — supports Claude models with typed SSE event parsing
  - `LLMConfig` now accepts `{ provider: 'openai' }` and `{ provider: 'anthropic' }` alongside existing `'gemini'` and `{ adapter }` options

  ### Test Coverage

  - VAD package: 28 tests covering init, processFrame, state machine, start/stop, destroy, events
  - React hooks: 26 tests covering all split hooks, combined hook, SSR safety, streaming
  - Core orchestrator: sendText, concurrent send rejection, rate limiting, privacy hooks

- feat: Phase 1 Foundation — token-aware context, markdown rendering, positioning engine, dark mode, error codes

  - Token-aware context budget with CJK support via estimateTokens()
  - Markdown rendering with marked 17.x (MarkdownRenderer, XSS sanitization, CSS custom properties)
  - Tooltip positioning refactored to @floating-ui/dom (computePosition + autoUpdate)
  - Dark mode support: ThemeEngine with light/dark/auto colorScheme, CSS design tokens
  - 11 new error codes for Knowledge, Cognitive, Plugin, Memory subsystems
  - 3 new error subclasses: KnowledgeError, PluginError, CognitiveError
  - Test infrastructure: extracted shared mock factories, per-glob coverage thresholds

### Patch Changes

- feat(intelligence): add @guidekit/intelligence package with semantic page analysis

  - ComponentDetector: ARIA-first UI component detection (tabs, modals, accordions, cards, wizards, etc.)
  - ErrorDetector: page error state detection via ARIA, class patterns, and text heuristics
  - FlowDetector: multi-step flow/wizard detection with step tracking
  - HeadingExtractor: document outline tree builder from h1-h6 elements
  - HallucinationGuard: LLM response validation against actual page state
  - SemanticScanner: orchestrator composing all detectors into SemanticPageModel
  - Added SemanticPageModel, ComponentNode, FlowState, PageErrorState, HeadingNode types to @guidekit/core

- feat(knowledge): add @guidekit/knowledge package with BM25/TF-IDF search

  - KnowledgeStore: document management with add/remove/update/search
  - BM25Index: BM25 Okapi relevance ranking (pure implementation, no deps)
  - TFIDFIndex: TF-IDF with logarithmic TF scoring
  - Document chunker with heading, paragraph, and fixed-size strategies
  - Source attribution with markdown citation formatting
  - Knowledge context provider for LLM prompt integration
  - Knowledge types added to @guidekit/core

- feat(plugins): add @guidekit/plugins package with plugin system

  - definePlugin() API for creating type-safe plugin definitions
  - PluginRegistry with install/uninstall/activate/deactivate lifecycle
  - MiddlewarePipeline for intercepting LLM calls, tool execution, and errors
  - Plugin types added to @guidekit/core: PluginDefinition, PluginContext, PluginHooks, PluginMetadata

- Updated dependencies
  - @guidekit/vad@0.1.0

## 0.1.0-beta.2

### Breaking Changes

- **LLM adapter pattern**: `LLMConfig` now uses `createAdapter()` with Gemini as default; custom adapters via `LLMProviderAdapter`
- **Key renames**: `geminiKey` → `llmApiKey`, `deepgramKey` → `sttApiKey`, `elevenlabsKey` → `ttsApiKey`

### New Features

- Web Speech API STT and TTS providers (browser-native, no API key required)
- ElevenLabs STT support
- `formatTools()` wraps tool parameters as JSON Schema objects (Gemini-compatible)

### Bug Fixes

- NaN guards in DOM overlay detection (`Number.isNaN` consistency)
- `safeOnDone` callback guard for streaming completion
- Chunked base64 audio encoding for large payloads
- LLM tool formatting for required[] arrays
- `tokenEndpoint` warning when misconfigured

### Dependencies

- @guidekit/vad@0.1.0-beta.2
