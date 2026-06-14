# @guidekit/cli

## 1.0.0

### Major Changes

- 2b44662: GuideKit 1.0 GA: async SessionStore, pipeline integrity, Platform Mode contracts, runtime knowledge API, docs/E2E parity, and Tier A lockstep release.

### Patch Changes

- Updated dependencies [2b44662]
  - @guidekit/server@1.0.0

## 0.2.0

### Minor Changes

- GuideKit v2 platform: pipeline orchestration, server LLM/voice proxy, cognitive engine, token budgets, platform extensions, telemetry, and a slimmer core facade.

### Patch Changes

- Updated dependencies
  - @guidekit/server@0.3.0

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
  - @guidekit/server@0.2.0

## 0.1.0-beta.3

### Patch Changes

- Version bump for upstream core changes (streaming, multi-provider LLM, Phase 1 foundation)

### Dependencies

- @guidekit/server@0.1.0-beta.3

## 0.1.0-beta.2

### Breaking Changes

- **Environment variable renames**: `GEMINI_KEY` → `LLM_API_KEY`, `DEEPGRAM_KEY` → `STT_API_KEY`, `ELEVENLABS_KEY` → `TTS_API_KEY` (backward-compat fallbacks included)

### Dependencies

- @guidekit/server@0.1.0-beta.2
