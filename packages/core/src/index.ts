// ---------------------------------------------------------------------------
// @guidekit/core — Public API
// ---------------------------------------------------------------------------

// Core orchestrator
export { GuideKitCore } from './core.js';
export type {
  GuideKitCoreOptions,
  HealthCheckResult,
  HealthCheckStatus,
  BeforeLLMCallContext,
} from './core.js';

// EventBus
export { EventBus, createEventBus } from './bus/index.js';
export type { EventMap } from './bus/index.js';

// Errors
export {
  ErrorCodes,
  GuideKitError,
  AuthenticationError,
  ConfigurationError,
  InitializationError,
  RateLimitError,
  ResourceExhaustedError,
  PermissionError,
  NetworkError,
  TimeoutError,
  BrowserSupportError,
  ContentFilterError,
  KnowledgeError,
  PluginError,
  CognitiveError,
  isGuideKitError,
} from './errors/index.js';
export type { ErrorCode, Provider, GuideKitErrorOptions } from './errors/index.js';

// Types
export type {
  GuideKitErrorType,
  ScanMetadata,
  PageSection,
  NavItem,
  InteractiveElement,
  FormField,
  FormSummary,
  OverlayElement,
  PageModel,
  ComponentNode,
  FlowState,
  PageErrorState,
  HeadingNode,
  HallucinationIssue,
  HallucinationResult,
  SemanticPageModel,
  AgentState,
  STTConfig,
  TTSConfig,
  LLMConfig,
  GuideKitOptions,
  AgentConfig,
  GuideKitTheme,
  ContentMapEntry,
  ContentMap,
  ContentMapFunction,
  ContentMapInput,
  ConversationTurn,
  SessionState,
  ConnectionState,
  GuideKitEvent,
  GuideKitProviderProps,
  ToolDefinition,
  ToolCall,
  TextChunk,
  LLMProviderAdapter,
  TokenPayload,
  TokenResponse,
  CreateSessionTokenOptions,
  GuideKitStore,
  StreamResult,
  TextStream,
  ToolParameterSchema,
  STTTranscriptEvent,
  PluginMetadata,
  MiddlewareFunction,
  BeforeLLMCallCtx,
  AfterLLMCallCtx,
  BeforeToolExecCtx,
  AfterToolExecCtx,
  OnErrorCtx,
  PluginHooks,
  PluginContext,
  PluginDefinition,
  KnowledgeDocument,
  KnowledgeChunk,
  SearchResult,
  SourceAttribution,
  ChunkStrategy,
  ChunkerOptions,
  SearchEngine,
  KnowledgeStoreOptions,
  KnowledgeSearchOptions,
} from './types/index.js';

// Resources
export { ResourceManager, SingletonGuard } from './resources/index.js';
export type { Resource, ResourceManagerState } from './resources/index.js';

// DOM
export { DOMScanner } from './dom/index.js';
export type { DOMScannerOptions } from './dom/index.js';

// Context
export { ContextManager, estimateTokens } from './context/index.js';
export type { ContextManagerOptions } from './context/index.js';

// LLM
export { LLMOrchestrator, GeminiAdapter, OpenAIAdapter, AnthropicAdapter } from './llm/index.js';
export type { OpenAIAdapterConfig } from './llm/openai-adapter.js';
export type { AnthropicAdapterConfig } from './llm/anthropic-adapter.js';

// Tool Executor
export { ToolExecutor } from './llm/tool-executor.js';
export type {
  ToolHandler,
  ToolExecutorOptions,
  ToolCallRecord,
  AggregatedUsage,
  ToolExecutionResult,
} from './llm/tool-executor.js';

// Visual Guidance
export { VisualGuidance } from './visual/index.js';
export type {
  VisualGuidanceOptions,
  TooltipOptions,
  SpotlightState,
} from './visual/index.js';

// Rendering & Theme — available via '@guidekit/core/rendering' subpath
// to keep `marked` out of bundles that don't need it.
// Re-export types only from main entry for convenience.
export type { MarkdownRenderer } from './rendering/markdown-renderer.js';
export type { ThemeEngine } from './rendering/theme-engine.js';

// Connectivity
export { ConnectionManager } from './connectivity/index.js';
export type { ConnectionManagerOptions, QueuedMessage } from './connectivity/index.js';

// Navigation
export { NavigationController } from './navigation/index.js';
export type { NavigationControllerOptions } from './navigation/index.js';

// Awareness
export { AwarenessSystem } from './awareness/index.js';
export type { AwarenessOptions, AwarenessState } from './awareness/index.js';

// Proactive Triggers
export { ProactiveTriggerEngine } from './awareness/proactive.js';
export type {
  ProactiveOptions,
  ProactiveTriggerType,
  ProactiveTrigger,
} from './awareness/proactive.js';

// Rate Limiter
export { RateLimiter } from './llm/rate-limiter.js';
export type {
  RateLimits,
  RateLimiterOptions,
  RateLimiterState,
} from './llm/rate-limiter.js';

// Auth
export { TokenManager } from './auth/token-manager.js';
export type { TokenData, TokenManagerOptions } from './auth/token-manager.js';

// i18n
export { I18n } from './i18n/index.js';
export type {
  I18nStrings,
  SupportedLocale,
  LocaleInput,
  I18nOptions,
} from './i18n/index.js';

// Voice — Web Speech API adapters (browser-native, zero-config defaults)
export { WebSpeechSTT } from './voice/web-speech-stt.js';
export type { WebSpeechSTTOptions } from './voice/web-speech-stt.js';
export { WebSpeechTTS } from './voice/web-speech-tts.js';
export type { WebSpeechTTSOptions, WebSpeechTTSAudioEvent } from './voice/web-speech-tts.js';

// Voice — VoicePipeline
export { VoicePipeline } from './voice/index.js';
export type { VoicePipelineOptions, VoiceState } from './voice/index.js';
