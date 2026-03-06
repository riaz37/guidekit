# @guidekit/react

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

### Patch Changes

- feat: Phase 1 Foundation — token-aware context, markdown rendering, positioning engine, dark mode, error codes

  - Token-aware context budget with CJK support via estimateTokens()
  - Markdown rendering with marked 17.x (MarkdownRenderer, XSS sanitization, CSS custom properties)
  - Tooltip positioning refactored to @floating-ui/dom (computePosition + autoUpdate)
  - Dark mode support: ThemeEngine with light/dark/auto colorScheme, CSS design tokens
  - 11 new error codes for Knowledge, Cognitive, Plugin, Memory subsystems
  - 3 new error subclasses: KnowledgeError, PluginError, CognitiveError
  - Test infrastructure: extracted shared mock factories, per-glob coverage thresholds

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @guidekit/core@0.1.0

## 0.1.0-beta.2

### Patch Changes

- Version bump for upstream core changes (provider-agnostic API, web-speech providers)

### Dependencies

- @guidekit/core@0.1.0-beta.2
