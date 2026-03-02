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
  | { provider: 'assemblyai'; apiKey: string };

/** Text-to-speech provider configuration. */
export type TTSConfig =
  | { provider: 'elevenlabs'; apiKey: string; voiceId?: string }
  | { provider: 'cartesia'; apiKey: string; voiceId?: string };

/** Large language model provider configuration. */
export type LLMConfig =
  | { provider: 'gemini'; apiKey: string; model?: 'gemini-2.5-flash' | 'gemini-2.5-pro' }
  | { provider: 'openai'; apiKey: string; model?: 'gpt-4o' | 'gpt-4o-mini' };

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

/** Definition of a tool that can be invoked by the LLM. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
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
  deepgramKey?: string;
  elevenlabsKey?: string;
  geminiKey?: string;
  expiresIn?: string;
  allowedOrigins?: string[];
  permissions?: string[];
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
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
}
