# @guidekit/knowledge

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

- feat(knowledge): add @guidekit/knowledge package with BM25/TF-IDF search

  - KnowledgeStore: document management with add/remove/update/search
  - BM25Index: BM25 Okapi relevance ranking (pure implementation, no deps)
  - TFIDFIndex: TF-IDF with logarithmic TF scoring
  - Document chunker with heading, paragraph, and fixed-size strategies
  - Source attribution with markdown citation formatting
  - Knowledge context provider for LLM prompt integration
  - Knowledge types added to @guidekit/core

### Patch Changes

- Updated dependencies
  - @guidekit/core@0.1.0
