# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0-beta] - 2025-03-02

### Added

#### Phase 1a: Text Foundation
- Core engine with DOM intelligence, LLM orchestration, and context management
- Typed EventBus with namespace subscriptions and error isolation
- Error hierarchy with 28 error codes and actionable suggestions
- Resource Manager with AbortController pattern and lifecycle tracking
- DOM Scanner with TreeWalker, PageModel, and `data-guidekit-ignore` support
- Context Manager with token budgeting and truncation metadata
- LLM Orchestrator with streaming responses (Gemini adapter)
- React Provider with split hooks (useGuideKitStatus, useGuideKitVoice, useGuideKitActions, useGuideKitContext)
- Shadow DOM widget with text input and transcript panel
- Token-based auth via @guidekit/server
- i18n support with 8 built-in locales

#### Phase 1b: Voice Layer
- @guidekit/vad package with Silero ONNX model
- Voice pipeline with VAD, STT (Deepgram), and TTS (ElevenLabs)
- Half-duplex voice with barge-in detection
- WebSocket connection manager with reconnection state machine
- Audio degradation: voice failure falls back to text-only mode

#### Phase 2: Visual Guidance
- LLM tool calling with multi-turn execution
- Spotlight overlay with ResizeObserver tracking
- Tooltip renderer and smooth scroller
- Navigation Controller (Navigation API + popstate fallback)
- Custom actions via registerAction API
- clickElement with security deny-list
- Widget theming via CSS custom properties

#### Phase 3: Awareness & Proactivity
- User Awareness System (viewport, scroll, dwell, idle, rage clicks)
- Proactive Trigger Engine with cooldowns
- Session persistence in sessionStorage
- ConnectionManager (online/degraded/offline)
- Client-side rate limiting for cost protection

#### Phase 4: Production Polish
- @guidekit/vanilla package (IIFE bundle for non-React)
- DevTools component for development
- Testing utilities (MockGuideKitProvider, simulateVoiceInput)
- Health check API
- CLI tools (init, doctor, generate-secret)
- Privacy manager with onBeforeLLMCall hook
- 893+ unit tests, 16 E2E tests
- Accessibility: WCAG 2.1 AA, keyboard navigation, screen reader support
