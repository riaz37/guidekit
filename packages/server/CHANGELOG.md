# @guidekit/server

## 1.1.0

### Minor Changes

- Add Agent Runtime v1 foundations: server-backed site knowledge search, `searchSite` tooling, guided autonomy policy, and action-risk classification for interactive elements.

## 1.0.2

### Patch Changes

- e504e76: Universal website assistant: PageMemory + TurnDelta incremental context, element resolver with dangerous-click gate, plain-page DOM heuristics, cross-origin iframe limitations, scroll-and-rescan, contract E2E matrix (plain page, SPA rescan, iframe, click safety, CSP vanilla), reliability scorecard docs, and SPA router integration for Next.js App Router.

  Production hardening: stable pipeline telemetry export and DevTools Telemetry tab; LLM/voice proxy permission and origin checks with request validation; example app Redis session-store path and operational docs (rate limits, failure modes, observability).

## 1.0.1

### Patch Changes

- 10de399: Harden real-app integration: session token recovery after server restart, voice widget transcript streaming, continuous mic listening, doctor VAD checks, voice E2E smoke tests, and full live-tier Playwright suite (agent tools, platform mode, proxy API, multi-turn).

## 1.0.0

### Major Changes

- 2b44662: GuideKit 1.0 GA: async SessionStore, pipeline integrity, Platform Mode contracts, runtime knowledge API, docs/E2E parity, and Tier A lockstep release.

## 0.3.0

### Minor Changes

- GuideKit v2 platform: pipeline orchestration, server LLM/voice proxy, cognitive engine, token budgets, platform extensions, telemetry, and a slimmer core facade.

## 0.2.0

### Minor Changes

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

## 0.1.0-beta.3

### Patch Changes

- Version bump for upstream core changes (streaming, multi-provider LLM, Phase 1 foundation)

### Dependencies

- @guidekit/core@0.1.0

## 0.1.0-beta.2

### Breaking Changes

- **Key renames**: `geminiKey` → `llmApiKey`, `deepgramKey` → `sttApiKey`, `elevenlabsKey` → `ttsApiKey`
