# @guidekit/core

## 0.1.0-beta.2

### Breaking Changes

- **LLM adapter pattern**: `LLMConfig` now uses `createAdapter()` with Gemini as default; custom adapters via `LLMProviderAdapter`. OpenAI adapter removed — use `{ adapter: yourAdapter }` for non-Gemini providers
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
