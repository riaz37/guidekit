/**
 * @module @guidekit/core/types
 *
 * Shared TypeScript types for the GuideKit SDK.
 * All types used across packages are defined and exported from this module.
 */

// ---------------------------------------------------------------------------
// GuideKitError reference type
// ---------------------------------------------------------------------------

/**
 * Reference type matching the GuideKitError class shape defined in ../errors/.
 * Used throughout the type system to avoid circular imports. The actual class
 * implementation lives in the errors module; this is the structural contract.
 */
export type GuideKitErrorType = Error & {
  readonly code: string;
  readonly provider?: string;
  readonly recoverable: boolean;
  readonly suggestion: string;
  readonly docsUrl: string;
};

// ---------------------------------------------------------------------------
// Page model
// ---------------------------------------------------------------------------

/** Metadata produced by the DOM scanner indicating work performed. */
export interface ScanMetadata {
  totalSectionsFound: number;
  sectionsIncluded: number;
  totalNodesScanned: number;
  scanBudgetExhausted: boolean;
}

/** A scored, labelled section of the current page. */
export interface PageSection {
  id: string;
  selector: string;
  tagName: string;
  label: string;
  summary: string;
  isVisible: boolean;
  visibilityRatio: number;
  score: number;
  landmark?: string;
  hasInteractiveElements: boolean;
  depth: number;
}

/** A navigation link discovered on the page. */
export interface NavItem {
  label: string;
  href: string;
  isCurrent: boolean;
  selector: string;
}

/** An interactive element (button, link, input, etc.) on the page. */
export interface InteractiveElement {
  selector: string;
  tagName: string;
  type?: string;
  label: string;
  role?: string;
  isDisabled: boolean;
  guideKitTarget?: string;
}

/** A single field inside a form. */
export interface FormField {
  selector: string;
  name: string;
  type: string;
  label: string;
  isRequired: boolean;
  hasError: boolean;
  errorMessage?: string;
}

/** Summary representation of a <form> element. */
export interface FormSummary {
  selector: string;
  id?: string;
  action?: string;
  fields: FormField[];
  hasValidationErrors: boolean;
}

/** An overlay (modal, drawer, dropdown, popover) currently present in the DOM. */
export interface OverlayElement {
  selector: string;
  type: 'modal' | 'drawer' | 'dropdown' | 'popover';
  label: string;
  isVisible: boolean;
}

/**
 * Complete snapshot of the current page produced by the page-awareness scanner.
 * Sent to the LLM as grounding context on every turn.
 */
export interface PageModel {
  url: string;
  title: string;
  meta: {
    description: string;
    h1: string | null;
    language: string;
  };
  sections: PageSection[];
  navigation: NavItem[];
  interactiveElements: InteractiveElement[];
  forms: FormSummary[];
  activeOverlays: OverlayElement[];
  viewport: {
    width: number;
    height: number;
    orientation: 'portrait' | 'landscape';
  };
  allSectionsSummary: string[];
  hash: string;
  timestamp: number;
  scanMetadata: ScanMetadata;
}

// ---------------------------------------------------------------------------
// Semantic Page Model (extends PageModel with intelligence data)
// ---------------------------------------------------------------------------

/** A detected UI component on the page. */
export interface ComponentNode {
  id: string;
  type: 'tab-group' | 'modal' | 'accordion' | 'card' | 'form-wizard'
      | 'data-table' | 'search' | 'breadcrumb' | 'dropdown' | 'unknown';
  selector: string;
  label: string;
  /** Detection confidence score (0-1). */
  confidence: number;
  /** Selectors of interactive elements within this component. */
  interactiveElements: string[];
  /** Component-specific state (e.g., active tab index, expanded panel). */
  state?: Record<string, unknown>;
}

/** Detected multi-step flow state (e.g., checkout step 2 of 4). */
export interface FlowState {
  type: 'checkout' | 'signup' | 'onboarding' | 'wizard' | 'survey' | 'custom';
  currentStep: number;
  totalSteps: number;
  stepLabels: string[];
  completedSteps: number[];
  /** Selector of the progress indicator element. */
  progressSelector?: string;
}

/** An error state detected on the page. */
export interface PageErrorState {
  type: 'form-validation' | 'api-error' | 'not-found' | 'permission'
      | 'toast-error' | 'inline-error' | 'banner-error';
  message: string;
  selector: string;
  severity: 'error' | 'warning' | 'info';
  /** Related form field selector, if applicable. */
  relatedField?: string;
  /** Whether the error is dismissible. */
  dismissible: boolean;
}

/** A heading in the document outline. */
export interface HeadingNode {
  level: number;
  text: string;
  id: string;
  selector: string;
  children: HeadingNode[];
}

/** Validation issue found by the hallucination guard. */
export interface HallucinationIssue {
  type: 'element-reference' | 'navigation-reference';
  claim: string;
  severity: 'low' | 'medium' | 'high';
  suggestion: string;
}

/** Result of hallucination guard validation. */
export interface HallucinationResult {
  isValid: boolean;
  confidence: number;
  issues: HallucinationIssue[];
}

/**
 * Extended page model with semantic intelligence data.
 * Produced by the SemanticScanner from @guidekit/intelligence.
 * All new fields are additive — PageModel consumers continue to work.
 */
export interface SemanticPageModel extends PageModel {
  /** Detected UI component patterns (tabs, modals, cards, etc.). */
  components: ComponentNode[];
  /** Detected multi-step flow state, or null if no flow detected. */
  flowState: FlowState | null;
  /** Active error states visible on the page. */
  errorStates: PageErrorState[];
  /** Document heading outline (h1-h6 tree). */
  headingOutline: HeadingNode[];
}

// ---------------------------------------------------------------------------
// Plugin types
// ---------------------------------------------------------------------------

/** Metadata describing a plugin. */
export interface PluginMetadata {
  name: string;
  version: string;
  description?: string;
  dependencies?: string[];
}

/** Async or sync middleware function. */
export type MiddlewareFunction<T = Record<string, unknown>> = (
  ctx: T,
  next: () => Promise<T>,
) => Promise<T> | T;

/** Context passed to beforeLLMCall middleware. */
export interface BeforeLLMCallCtx {
  systemPrompt: string;
  userMessage: string;
  conversationHistory: Array<{ role: string; content: string }>;
  metadata: Record<string, unknown>;
}

/** Context passed to afterLLMCall middleware. */
export interface AfterLLMCallCtx {
  responseText: string;
  toolCalls: ToolCall[];
  usage: { prompt: number; completion: number; total: number } | null;
  metadata: Record<string, unknown>;
}

/** Context passed to beforeToolExecution middleware. */
export interface BeforeToolExecCtx {
  toolName: string;
  arguments: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

/** Context passed to afterToolExecution middleware. */
export interface AfterToolExecCtx {
  toolName: string;
  arguments: Record<string, unknown>;
  result: unknown;
  durationMs: number;
  metadata: Record<string, unknown>;
}

/** Context passed to onError middleware. */
export interface OnErrorCtx {
  error: Error;
  phase: 'llm' | 'tool' | 'voice' | 'dom' | 'unknown';
  metadata: Record<string, unknown>;
}

/** Hook points a plugin can intercept. */
export interface PluginHooks {
  beforeLLMCall?: MiddlewareFunction<BeforeLLMCallCtx>;
  afterLLMCall?: MiddlewareFunction<AfterLLMCallCtx>;
  beforeToolExecution?: MiddlewareFunction<BeforeToolExecCtx>;
  afterToolExecution?: MiddlewareFunction<AfterToolExecCtx>;
  onError?: MiddlewareFunction<OnErrorCtx>;
}

/** Scoped API surface available to a plugin during its lifecycle. */
export interface PluginContext {
  bus: { on: (event: string, handler: (...args: unknown[]) => void) => () => void };
  registerTool: (definition: ToolDefinition, handler: (args: Record<string, unknown>) => Promise<unknown>) => void;
  addContextProvider: (id: string, provider: () => string | Promise<string>) => void;
  getAgentState: () => AgentState;
  log: (...args: unknown[]) => void;
}

/** Full plugin definition returned by definePlugin(). */
export interface PluginDefinition {
  readonly metadata: Readonly<PluginMetadata>;
  readonly hooks: Readonly<PluginHooks>;
  readonly setup: (ctx: PluginContext) => Promise<(() => void) | void> | ((() => void) | void);
  readonly __brand: 'GuideKitPlugin';
}

// ---------------------------------------------------------------------------
// Knowledge types
// ---------------------------------------------------------------------------

/** A document in the knowledge base. */
export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  chunks?: KnowledgeChunk[];
}

/** A chunk of a document after splitting. */
export interface KnowledgeChunk {
  id: string;
  documentId: string;
  content: string;
  index: number;
  startOffset: number;
  endOffset: number;
  headingContext?: string;
}

/** A search result with relevance score and source attribution. */
export interface SearchResult {
  chunk: KnowledgeChunk;
  score: number;
  source: SourceAttribution;
}

/** Attribution metadata linking a search result to its source document. */
export interface SourceAttribution {
  documentId: string;
  chunkId: string;
  title: string;
  relevanceScore: number;
  excerpt: string;
}

/** Strategy for splitting documents into chunks. */
export type ChunkStrategy = 'heading' | 'paragraph' | 'fixed';

/** Options for the document chunker. */
export interface ChunkerOptions {
  strategy: ChunkStrategy;
  chunkSize?: number;
  overlap?: number;
}

/** Search engine type. */
export type SearchEngine = 'bm25' | 'tfidf';

/** Options for the knowledge store. */
export interface KnowledgeStoreOptions {
  engine?: SearchEngine;
  chunker?: ChunkerOptions;
  maxDocuments?: number;
  maxTotalChunks?: number;
  persistConsent?: boolean;
  dbName?: string;
  topK?: number;
}

/** Options for a single search query. */
export interface KnowledgeSearchOptions {
  topK?: number;
  engine?: SearchEngine;
  documentIds?: string[];
  minScore?: number;
}

// ---------------------------------------------------------------------------
// Agent state (discriminated union)
// ---------------------------------------------------------------------------

/** Discriminated union describing every possible state the agent can be in. */
export type AgentState =
  | { status: 'idle' }
  | { status: 'listening'; durationMs: number }
  | { status: 'processing'; transcript: string }
  | { status: 'speaking'; utterance: string }
  | { status: 'error'; error: GuideKitErrorType };

// ---------------------------------------------------------------------------
// Provider configs (discriminated unions)
// ---------------------------------------------------------------------------

/** Speech-to-text provider configuration. */
export type STTConfig =
  | { provider: 'deepgram'; apiKey: string; model?: 'nova-2' | 'nova-3' }
  | { provider: 'elevenlabs'; apiKey: string; language?: string }
  | { provider: 'web-speech'; language?: string; continuous?: boolean; interimResults?: boolean };

/** Text-to-speech provider configuration. */
export type TTSConfig =
  | { provider: 'elevenlabs'; apiKey: string; voiceId?: string }
  | { provider: 'web-speech'; voice?: string; rate?: number; pitch?: number; language?: string };

/** Transcript event emitted by any STT adapter. */
export interface STTTranscriptEvent {
  text: string;
  isFinal: boolean;
  confidence: number;
  timestamp: number;
}

/** Large language model provider configuration. */
export type LLMConfig =
  | { provider: 'gemini'; apiKey: string; model?: 'gemini-2.5-flash' | 'gemini-2.5-pro' }
  | { provider: 'openai'; apiKey: string; model?: string; baseUrl?: string }
  | { provider: 'anthropic'; apiKey: string; model?: string; maxTokens?: number }
  | { adapter: LLMProviderAdapter };

// ---------------------------------------------------------------------------
// GuideKit options
// ---------------------------------------------------------------------------

/** Top-level options that control SDK behaviour. */
export interface GuideKitOptions {
  locale?: string | 'auto';
  mode?: 'voice' | 'text' | 'auto';
  greetOnFirstVisit?: boolean;
  spotlightColor?: string;
  consentRequired?: boolean;
  debug?: boolean;
  rateLimits?: {
    maxLLMCallsPerMinute?: number;
    maxSTTMinutesPerSession?: number;
    maxTTSCharsPerSession?: number;
  };
  clickableSelectors?: {
    allow?: string[];
    deny?: string[];
  };
  safetySettings?: Record<string, string>;
  /** Maximum character length for user messages. Default: 10000. */
  maxMessageLength?: number;
}

// ---------------------------------------------------------------------------
// Agent config
// ---------------------------------------------------------------------------

/** Configuration for the assistant persona. */
export interface AgentConfig {
  name?: string;
  greeting?: string;
  personality?: string;
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

/** Visual customisation of the GuideKit widget. */
export interface GuideKitTheme {
  primaryColor?: string;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  borderRadius?: string;
  /** Color scheme: 'light', 'dark', or 'auto' (respects prefers-color-scheme). Default: 'light'. */
  colorScheme?: 'light' | 'dark' | 'auto';
  /** CSS custom property overrides for fine-grained theming. */
  tokens?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Content map
// ---------------------------------------------------------------------------

/** A single entry in the developer-supplied content map. */
export interface ContentMapEntry {
  description: string;
  facts?: string[];
}

/** Static content map keyed by section ID or URL pattern. */
export type ContentMap = Record<string, ContentMapEntry>;

/** Callback-based content map for dynamic or async lookups. */
export type ContentMapFunction = (
  sectionId: string,
) => ContentMapEntry | null | Promise<ContentMapEntry | null>;

/** Accepted input types for the content map prop. */
export type ContentMapInput = ContentMap | ContentMapFunction;

// ---------------------------------------------------------------------------
// Session state (persistence)
// ---------------------------------------------------------------------------

/** A single turn in the conversation history. */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/** Serialisable session state for persistence across page navigations. */
export interface SessionState {
  conversationHistory: ConversationTurn[];
  currentUrl: string;
  agentStatus: AgentState['status'];
  userPreference: 'voice' | 'text';
  quietMode: boolean;
  totalSizeBytes: number;
}

// ---------------------------------------------------------------------------
// Connection state
// ---------------------------------------------------------------------------

/** Network connectivity state observed by the SDK. */
export type ConnectionState = 'online' | 'degraded' | 'offline';

// ---------------------------------------------------------------------------
// GuideKit events & provider props
// ---------------------------------------------------------------------------

/** An event emitted by the SDK via the `onEvent` callback. */
export interface GuideKitEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

/** Props accepted by the `<GuideKitProvider>` React component. */
export interface GuideKitProviderProps {
  tokenEndpoint?: string;
  stt?: STTConfig;
  tts?: TTSConfig;
  llm?: LLMConfig;
  agent?: AgentConfig;
  contentMap?: ContentMapInput;
  options?: GuideKitOptions;
  theme?: GuideKitTheme;
  locale?: string | 'auto';
  instanceId?: string;
  rootElement?: HTMLElement;
  onError?: (error: GuideKitErrorType) => void;
  onEvent?: (event: GuideKitEvent) => void;
  onReady?: () => void;
  onBeforeLLMCall?: (context: {
    systemPrompt: string;
    userMessage: string;
    conversationHistory: Array<{ role: string; content: string }>;
  }) => { systemPrompt: string; userMessage: string; conversationHistory: Array<{ role: string; content: string }> } | Promise<{ systemPrompt: string; userMessage: string; conversationHistory: Array<{ role: string; content: string }> }>;
  children?: unknown;
}

// ---------------------------------------------------------------------------
// LLM types
// ---------------------------------------------------------------------------

/** A single JSON-Schema-style property descriptor used in tool parameter maps. */
export interface ToolParameterSchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: { type: string };
  [key: string]: unknown;
}

/** Definition of a tool that can be invoked by the LLM. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** Flat map of param name → JSON Schema property descriptor. */
  parameters: Record<string, ToolParameterSchema>;
  /**
   * List of parameter names the LLM must always provide.
   * Omit or use [] for fully optional parameters.
   */
  required?: string[];
  schemaVersion: number;
}

/** A tool invocation request returned by the LLM. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** A chunk of streamed text from the LLM. */
export interface TextChunk {
  text: string;
  done: boolean;
}

/**
 * Adapter interface that each LLM provider must implement.
 * Handles format conversion between GuideKit's internal representation
 * and the provider-specific wire format.
 */
export interface LLMProviderAdapter {
  formatTools(tools: ToolDefinition[]): unknown;
  formatConversation(history: ConversationTurn[]): unknown;
  parseResponse(stream: ReadableStream): AsyncIterable<TextChunk | ToolCall>;
  formatToolResult(callId: string, result: unknown): unknown;
  /**
   * Build and execute a streaming request to the provider API.
   * Returns the raw ReadableStream for the response body.
   */
  streamRequest(params: {
    systemPrompt: string;
    contents: unknown;
    userMessage?: string;
    tools?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<{ stream: ReadableStream<Uint8Array>; response: Response }>;
  /**
   * Check whether a parsed response chunk indicates the response was
   * blocked by a content/safety filter.
   */
  isContentFiltered(chunk: Record<string, unknown>): boolean;
  /**
   * Extract token usage from a parsed response chunk.
   * Returns `null` if no usage metadata is present in this chunk.
   */
  extractUsage(chunk: Record<string, unknown>): { prompt: number; completion: number; total: number } | null;
}

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

/** Decoded payload of a GuideKit session token. */
export interface TokenPayload {
  sessionId: string;
  expiresAt: number;
  audience: string[];
  permissions: string[];
  userId?: string;
  metadata?: Record<string, unknown>;
  iat: number;
}

/** Response returned by the token endpoint. */
export interface TokenResponse {
  token: string;
  expiresIn: number;
  expiresAt: number;
}

/** Options for `createSessionToken()` on the server side. */
export interface CreateSessionTokenOptions {
  signingSecret: string | string[];
  sttApiKey?: string;
  ttsApiKey?: string;
  llmApiKey?: string;
  expiresIn?: string;
  allowedOrigins?: string[];
  permissions?: string[];
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Streaming types
// ---------------------------------------------------------------------------

/** Result metadata returned when a streaming response completes. */
export interface StreamResult {
  fullText: string;
  totalTokens: number;
  toolCallsExecuted: number;
  rounds: number;
}

/** Return type of `sendTextStream()`. */
export interface TextStream {
  stream: AsyncIterable<string>;
  done: Promise<StreamResult>;
}

// ---------------------------------------------------------------------------
// Store state (useSyncExternalStore)
// ---------------------------------------------------------------------------

/** Shape of the external store consumed by React hooks. */
export interface GuideKitStore {
  status: {
    isReady: boolean;
    agentState: AgentState;
    error: GuideKitErrorType | null;
  };
  voice: {
    isListening: boolean;
    isSpeaking: boolean;
  };
  /** Whether the user has granted privacy consent. Always `true` when `consentRequired` is not enabled. Managed by the React widget layer. */
  hasConsent?: boolean;
  streaming?: {
    isStreaming: boolean;
    streamingText: string;
  };
}
