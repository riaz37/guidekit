// ---------------------------------------------------------------------------
// GuideKit SDK – Core Orchestrator
// ---------------------------------------------------------------------------
//
// The main class that wires all subsystems together. The constructor does NOT
// call any browser APIs — everything is lazily initialized in `init()` so the
// module is safe to import in SSR / Node environments.
// ---------------------------------------------------------------------------

import { EventBus, createEventBus } from './bus/index.js';
import { ResourceManager, SingletonGuard } from './resources/index.js';
import { DOMScanner } from './dom/index.js';
import { ContextManager } from './context/index.js';
import { LLMOrchestrator } from './llm/index.js';
import { ToolExecutor } from './llm/tool-executor.js';
import { ConnectionManager } from './connectivity/index.js';
import { NavigationController } from './navigation/index.js';
import { VoicePipeline, type VoicePipelineOptions } from './voice/index.js';
import { VisualGuidance } from './visual/index.js';
import { AwarenessSystem } from './awareness/index.js';
import { ProactiveTriggerEngine } from './awareness/proactive.js';
import { RateLimiter } from './llm/rate-limiter.js';
import { I18n, type LocaleInput } from './i18n/index.js';
import { TokenManager } from './auth/token-manager.js';
import type {
  PageModel,
  AgentConfig,
  ContentMapInput,
  LLMConfig,
  STTConfig,
  TTSConfig,
  GuideKitOptions,
  ToolDefinition,
  ToolParameterSchema,
  GuideKitEvent,
  AgentState,
  GuideKitStore,
  TextStream,
  StreamResult,
} from './types/index.js';
import { GuideKitError, ConfigurationError, ErrorCodes } from './errors/index.js';

// ---------------------------------------------------------------------------
// Default deny-list for clickElement tool
// ---------------------------------------------------------------------------

const DEFAULT_CLICK_DENY = [
  '[type="submit"]',
  '[type="reset"]',
  'button[formaction]',
  '[data-guidekit-no-click]',
  'form',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a UUID, guarded for non-browser environments where
 * `crypto.randomUUID()` may not be available.
 */
function generateUUID(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  // Fallback: manual v4 UUID generation (RFC 4122 compliant)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------------------------------------------------------------------------
// Options interface
// ---------------------------------------------------------------------------

/** Result of a health check on a single service. */
export interface HealthCheckStatus {
  status: 'ok' | 'degraded' | 'unavailable' | 'not-configured';
  latencyMs?: number;
  error?: string;
}

/** Full health check result. */
export interface HealthCheckResult {
  llm: HealthCheckStatus;
  stt: HealthCheckStatus;
  tts: HealthCheckStatus;
  mic: HealthCheckStatus;
  overall: 'ok' | 'degraded' | 'unavailable';
}

/** Context passed to onBeforeLLMCall for privacy filtering. */
export interface BeforeLLMCallContext {
  systemPrompt: string;
  userMessage: string;
  conversationHistory: Array<{ role: string; content: string }>;
}

export interface GuideKitCoreOptions {
  tokenEndpoint?: string;
  stt?: STTConfig;
  tts?: TTSConfig;
  llm?: LLMConfig;
  agent?: AgentConfig;
  contentMap?: ContentMapInput;
  options?: GuideKitOptions;
  instanceId?: string;
  rootElement?: HTMLElement;
  onError?: (error: GuideKitError) => void;
  onEvent?: (event: GuideKitEvent) => void;
  onReady?: () => void;
  /**
   * Privacy hook: called before every LLM request. Return modified context
   * or throw to cancel the request. Use for custom PII scrubbing.
   */
  onBeforeLLMCall?: (context: BeforeLLMCallContext) => BeforeLLMCallContext | Promise<BeforeLLMCallContext>;
}

// ---------------------------------------------------------------------------
// GuideKitCore
// ---------------------------------------------------------------------------

export class GuideKitCore {
  // ---- Public readonly accessors ------------------------------------------

  readonly instanceId: string;
  readonly bus: EventBus;

  // ---- Subsystems (created lazily or on init) -----------------------------

  private resourceManager: ResourceManager;
  private domScanner: DOMScanner | null = null;
  private contextManager: ContextManager;
  private llmOrchestrator: LLMOrchestrator | null = null;
  private connectionManager: ConnectionManager | null = null;
  private navigationController: NavigationController | null = null;
  private voicePipeline: VoicePipeline | null = null;
  private visualGuidance: VisualGuidance | null = null;
  private toolExecutor: ToolExecutor | null = null;
  private awarenessSystem: AwarenessSystem | null = null;
  private proactiveEngine: ProactiveTriggerEngine | null = null;
  private rateLimiter: RateLimiter;
  private _i18n: I18n;
  private tokenManager: TokenManager | null = null;

  // ---- State --------------------------------------------------------------

  private _isReady = false;
  private _agentState: AgentState = { status: 'idle' };
  private _currentPageModel: PageModel | null = null;
  private readonly _options: GuideKitCoreOptions;
  private _debug: boolean;
  private _sendInFlight = false;
  private _isStreaming = false;
  private _streamingText = '';
  private _instanceAbortController = new AbortController();
  private _initPromise: Promise<void> | null = null;

  // ---- Store for useSyncExternalStore -------------------------------------

  private storeListeners: Set<() => void> = new Set();
  private _storeSnapshot: GuideKitStore;

  // ---- Custom actions -----------------------------------------------------

  private customActions = new Map<
    string,
    {
      description: string;
      parameters: Record<string, unknown>;
      handler: (params: Record<string, unknown>) => Promise<unknown>;
    }
  >();

  // -------------------------------------------------------------------------
  // Constructor — NO browser APIs (SSR safe)
  // -------------------------------------------------------------------------

  constructor(options: GuideKitCoreOptions) {
    this._options = options;
    this.instanceId = options.instanceId ?? 'default';
    this._debug = options.options?.debug ?? false;

    // Create EventBus (no browser APIs)
    this.bus = createEventBus({ debug: this._debug });

    // Get or create ResourceManager via SingletonGuard
    this.resourceManager = SingletonGuard.acquire(
      this.instanceId,
      () => new ResourceManager(this.instanceId),
    );

    // Create ContextManager (no browser APIs in constructor)
    this.contextManager = new ContextManager({
      agent: options.agent,
      contentMap: options.contentMap,
      debug: this._debug,
    });

    // Sync initial mode → userPreference so the system prompt is voice-aware
    const mode = options.options?.mode;
    if (mode === 'voice' || mode === 'text') {
      this.contextManager.userPreference = mode;
    }

    // Create RateLimiter (no browser APIs)
    this.rateLimiter = new RateLimiter({
      bus: this.bus,
      limits: options.options?.rateLimits,
      debug: this._debug,
    });

    // Create I18n (auto-detect is SSR-safe)
    this._i18n = new I18n({
      locale: (options.options?.locale as LocaleInput) ?? 'auto',
      debug: this._debug,
    });

    // Initialize store snapshot
    this._storeSnapshot = this.buildSnapshot();

    // Wire up error handler
    if (options.onError) {
      this.bus.on('error', (err) => {
        if (err instanceof GuideKitError) {
          options.onError!(err);
        }
      });
    }

    // Wire up event forwarding
    if (options.onEvent) {
      this.bus.onAny((data, eventName) => {
        options.onEvent!({
          type: eventName,
          data:
            typeof data === 'object' && data !== null
              ? (data as Record<string, unknown>)
              : {},
          timestamp: Date.now(),
        });
      });
    }
  }

  // -------------------------------------------------------------------------
  // init() — starts all browser-dependent subsystems
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    if (typeof window === 'undefined') return;
    if (this._isReady) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._doInit();
    try {
      await this._initPromise;
    } catch (err) {
      this._initPromise = null;
      throw err;
    }
  }

  private async _doInit(): Promise<void> {
    // Validate LLM config
    const llmConfig = this._options.llm;
    if (!llmConfig && !this._options.tokenEndpoint) {
      throw new ConfigurationError({
        code: ErrorCodes.CONFIG_MISSING_REQUIRED,
        message: 'Either tokenEndpoint or llm config must be provided.',
        suggestion:
          'Add tokenEndpoint="/api/guidekit/token" or llm={{ provider: "gemini", apiKey: "..." }} to GuideKitProvider.',
      });
    }

    // -- Token Manager (if tokenEndpoint is provided) -----------------------

    if (this._options.tokenEndpoint) {
      this.tokenManager = new TokenManager({
        tokenEndpoint: this._options.tokenEndpoint,
        instanceId: this.instanceId,
        bus: this.bus,
        debug: this._debug,
      });
      await this.tokenManager.start();
      if (!this._options.llm) {
        console.warn(
          '[GuideKit] tokenEndpoint provided without llm config. ' +
          'The session token handles auth only — llm: { provider, apiKey } is still required ' +
          'for LLM calls. See: https://guidekit.dev/docs/provider#token-endpoint',
        );
      }
      this.resourceManager.register({
        name: 'token-manager',
        cleanup: () => this.tokenManager?.destroy(),
      });
    }

    // -- DOM Scanner --------------------------------------------------------

    this.domScanner = new DOMScanner({
      rootElement: this._options.rootElement,
      debug: this._debug,
    });

    // Initial scan
    this._currentPageModel = this.domScanner.scan();
    this.bus.emit('dom:scan-complete', {
      pageModel: this._currentPageModel,
      durationMs: 0,
    });

    // Set up MutationObserver for auto-rescan
    const unobserve = this.domScanner.observe((model) => {
      this._currentPageModel = model;
      this.bus.emit('dom:scan-complete', {
        pageModel: model,
        durationMs: 0,
      });
      this.notifyStoreListeners();
    });
    this.resourceManager.register({
      name: 'dom-observer',
      cleanup: unobserve,
    });

    // -- LLM Orchestrator ---------------------------------------------------

    if (llmConfig) {
      this.llmOrchestrator = new LLMOrchestrator({
        config: llmConfig,
        debug: this._debug,
        onChunk: (chunk) => {
          this.bus.emit('llm:response-chunk', chunk);
        },
        onToolCall: (toolCall) => {
          this.bus.emit('llm:tool-call', toolCall);
        },
        onTokenUsage: (usage) => {
          this.bus.emit('llm:token-usage', usage);
        },
        onError: (error) => {
          this.bus.emit('error', error);
        },
      });
    }

    // -- ConnectionManager --------------------------------------------------

    this.connectionManager = new ConnectionManager({
      healthEndpoint: this._options.tokenEndpoint
        ? this._options.tokenEndpoint.replace(/\/token$/, '/health')
        : undefined,
      debug: this._debug,
    });
    this.connectionManager.onStateChange((state, previous) => {
      this.bus.emit('connectivity:state-change', { state, previous });
    });
    this.connectionManager.start();
    this.resourceManager.register({
      name: 'connection-manager',
      cleanup: () => this.connectionManager?.stop(),
    });

    // -- NavigationController -----------------------------------------------

    this.navigationController = new NavigationController({
      debug: this._debug,
    });
    this.navigationController.onRouteChange((from, to) => {
      this.bus.emit('dom:route-change', { from, to });

      // Re-scan DOM on route change (allow a brief settling period)
      if (this.domScanner) {
        setTimeout(() => {
          this._currentPageModel = this.domScanner!.scan();
          this.bus.emit('dom:scan-complete', {
            pageModel: this._currentPageModel,
            durationMs: 0,
          });
          this.notifyStoreListeners();
        }, 100);
      }
    });
    this.navigationController.start();
    this.resourceManager.register({
      name: 'navigation-controller',
      cleanup: () => this.navigationController?.stop(),
    });

    // -- Visual Guidance System -----------------------------------------------

    this.visualGuidance = new VisualGuidance({
      spotlightColor: this._options.options?.spotlightColor,
      debug: this._debug,
    });
    this.resourceManager.register({
      name: 'visual-guidance',
      cleanup: () => this.visualGuidance?.destroy(),
    });

    // -- Awareness System ---------------------------------------------------

    this.awarenessSystem = new AwarenessSystem({
      bus: this.bus,
      rootElement: this._options.rootElement,
      debug: this._debug,
    });
    this.awarenessSystem.start();
    this.resourceManager.register({
      name: 'awareness-system',
      cleanup: () => this.awarenessSystem?.destroy(),
    });

    // -- Proactive Trigger Engine ------------------------------------------

    this.proactiveEngine = new ProactiveTriggerEngine({
      bus: this.bus,
      debug: this._debug,
      onTrigger: (trigger) => {
        if (this._debug) {
          console.debug('[GuideKit:Core] Proactive trigger:', trigger.type, trigger);
        }
        // Forward as a generic event for developer hooks
        this._options.onEvent?.({
          type: `proactive:${trigger.type}`,
          data: trigger as unknown as Record<string, unknown>,
          timestamp: trigger.timestamp,
        });
      },
    });
    this.proactiveEngine.start();
    this.resourceManager.register({
      name: 'proactive-engine',
      cleanup: () => this.proactiveEngine?.destroy(),
    });

    // -- Tool Executor (multi-turn tool calling) ----------------------------

    this.toolExecutor = new ToolExecutor({
      maxRounds: 5,
      debug: this._debug,
      onToolCall: (name, args) => {
        this.bus.emit('llm:tool-call', { name, arguments: args });
      },
    });

    this.registerBuiltinTools();

    // -- Voice Pipeline (lazy — only init on first startListening) ----------
    // Default to web-speech (browser-native, zero-config) when no STT/TTS
    // config is provided. Falls back gracefully in non-browser environments.

    {
      const sttConfig: STTConfig = this._options.stt ?? { provider: 'web-speech' };
      const ttsConfig: TTSConfig = this._options.tts ?? { provider: 'web-speech' };

      // Build the VoicePipeline options based on provider type
      let voiceSttConfig: VoicePipelineOptions['sttConfig'];
      let voiceTtsConfig: VoicePipelineOptions['ttsConfig'];

      if (sttConfig.provider === 'deepgram') {
        voiceSttConfig = {
          provider: 'deepgram',
          apiKey: sttConfig.apiKey,
          model: sttConfig.model,
        };
      } else if (sttConfig.provider === 'elevenlabs') {
        voiceSttConfig = {
          provider: 'elevenlabs',
          apiKey: sttConfig.apiKey,
          language: sttConfig.language,
        };
      } else {
        voiceSttConfig = {
          provider: 'web-speech',
          language: sttConfig.language,
          continuous: sttConfig.continuous,
          interimResults: sttConfig.interimResults,
        };
      }

      if (ttsConfig.provider === 'elevenlabs') {
        voiceTtsConfig = {
          provider: 'elevenlabs',
          apiKey: ttsConfig.apiKey,
          voiceId: 'voiceId' in ttsConfig ? ttsConfig.voiceId : undefined,
        };
      } else {
        voiceTtsConfig = {
          provider: 'web-speech',
          voice: ttsConfig.voice,
          rate: ttsConfig.rate,
          pitch: ttsConfig.pitch,
          language: ttsConfig.language,
        };
      }

      try {
        this.voicePipeline = new VoicePipeline({
          sttConfig: voiceSttConfig,
          ttsConfig: voiceTtsConfig,
          debug: this._debug,
        });

        // Forward voice events to the EventBus
        this.voicePipeline.onStateChange((state, previous) => {
          this.bus.emit('voice:state-change', { from: previous, to: state });
          // Map voice state to agent state
          switch (state) {
            case 'listening':
              this.setAgentState({ status: 'listening', durationMs: 0 });
              break;
            case 'speaking':
              this.setAgentState({ status: 'speaking', utterance: '' });
              break;
            case 'idle':
              if (this._agentState.status !== 'processing') {
                this.setAgentState({ status: 'idle' });
              }
              break;
          }
        });

        this.voicePipeline.onTranscript((text, isFinal) => {
          this.bus.emit('voice:transcript', {
            text,
            isFinal,
            confidence: 0.95,
          });
          if (isFinal && text.trim()) {
            this.voicePipeline?.processTranscript(text, (t) => this.sendText(t));
          }
        });

        this.resourceManager.register({
          name: 'voice-pipeline',
          cleanup: () => this.voicePipeline?.destroy(),
        });
      } catch (_err) {
        // Voice pipeline may fail in non-browser environments (SSR, jsdom)
        this.voicePipeline = null as unknown as VoicePipeline;
        if (this._debug) {
          console.debug('[GuideKit:Core] Voice pipeline unavailable in this environment');
        }
      }
    }

    // -- Restore session ----------------------------------------------------

    const session = this.contextManager.restoreSession();
    if (session && this._debug) {
      console.debug(
        '[GuideKit:Core] Restored session with',
        session.conversationHistory.length,
        'turns',
      );
    }

    // -- Mark ready ---------------------------------------------------------

    this.resourceManager.markReady();
    this._isReady = true;
    this.notifyStoreListeners();
    this._options.onReady?.();

    if (this._debug) {
      console.debug('[GuideKit:Core] Initialized', {
        instanceId: this.instanceId,
        sections: this._currentPageModel?.sections.length,
      });
    }
  }

  // -------------------------------------------------------------------------
  // sendText — send a text message to the LLM (delegates to sendTextStream)
  // -------------------------------------------------------------------------

  async sendText(message: string): Promise<string> {
    const { stream, done } = this.sendTextStream(message);
    // Prevent unhandled rejection on the done promise if the stream throws.
    done.catch(() => {});
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of stream) { /* consume to drive completion */ }
    const result = await done;
    return result.fullText;
  }

  // -------------------------------------------------------------------------
  // sendTextStream — streaming text message to the LLM
  // -------------------------------------------------------------------------

  sendTextStream(message_: string): TextStream {
    // ---- Synchronous validations (throw before returning) ----------------

    if (!this._isReady || !this.llmOrchestrator) {
      throw new ConfigurationError({
        code: ErrorCodes.CONFIG_MISSING_REQUIRED,
        message: 'SDK not initialized or LLM not configured.',
        suggestion:
          'Ensure init() has been called and LLM config is provided.',
      });
    }

    if (this._sendInFlight) {
      throw new GuideKitError({
        code: 'SEND_IN_FLIGHT',
        message: 'A message is already being processed. Wait for it to complete.',
        recoverable: true,
        suggestion: 'Await the previous sendText() call before sending another message.',
      });
    }

    const maxLen = this._options.options?.maxMessageLength ?? 10_000;
    if (message_.length > maxLen) {
      throw new GuideKitError({
        code: 'INPUT_TOO_LONG',
        message: `Message exceeds maximum length of ${maxLen} characters.`,
        recoverable: true,
        suggestion: `Shorten your message to ${maxLen} characters or fewer, or increase maxMessageLength in options.`,
      });
    }

    // Check rate limits before proceeding
    this.rateLimiter.checkLLMCall();

    // Set _sendInFlight synchronously to prevent concurrent calls.
    this._sendInFlight = true;

    // ---- Deferred promise for the done signal ----------------------------

    let resolveDone!: (result: StreamResult) => void;
    let rejectDone!: (error: Error) => void;
    const done = new Promise<StreamResult>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });

    // Capture references for the generator closure.
    const self = this;
    const llmOrchestrator = this.llmOrchestrator;

    async function* generate(): AsyncGenerator<string> {
      let message = message_;
      let responseText = '';
      let totalTokens = 0;
      let toolCallsExecuted = 0;
      let rounds = 0;

      try {
        self._isStreaming = true;
        self._streamingText = '';
        self.notifyStoreListeners();

        // Update agent state
        self.setAgentState({ status: 'processing', transcript: message });

        // Add user turn
        self.contextManager.addTurn({
          role: 'user',
          content: message,
          timestamp: Date.now(),
        });

        // Build system prompt
        let systemPrompt = self.contextManager.buildSystemPrompt(
          self._currentPageModel!,
          self.getToolDefinitions(),
        );

        // Privacy hook — allow developer to scrub PII before LLM call
        if (self._options.onBeforeLLMCall) {
          try {
            const ctx = await self._options.onBeforeLLMCall({
              systemPrompt,
              userMessage: message,
              conversationHistory: self.contextManager
                .getHistory()
                .map((t) => ({ role: t.role, content: t.content })),
            });
            systemPrompt = ctx.systemPrompt;
            message = ctx.userMessage;
          } catch (hookErr) {
            // Hook threw — cancel the LLM call
            self.setAgentState({ status: 'idle' });
            const err =
              hookErr instanceof GuideKitError
                ? hookErr
                : new GuideKitError({
                    code: ErrorCodes.PRIVACY_HOOK_CANCELLED,
                    message:
                      hookErr instanceof Error
                        ? hookErr.message
                        : 'onBeforeLLMCall hook cancelled the request.',
                    recoverable: true,
                    suggestion: 'Check your onBeforeLLMCall implementation.',
                  });
            self.bus.emit('error', err);
            throw err;
          }
        }

        const conversationId = generateUUID();
        self.bus.emit('llm:response-start', { conversationId });

        // Use multi-turn ToolExecutor streaming if available, else single-turn
        if (self.toolExecutor) {
          const gen = self.toolExecutor.executeWithToolsStream({
            llm: llmOrchestrator,
            systemPrompt,
            history: self.contextManager.getHistory().slice(0, -1),
            userMessage: message,
            tools: self.getToolDefinitions(),
            signal: self._instanceAbortController.signal,
          });

          let streamResult = await gen.next();
          while (!streamResult.done) {
            const chunk = streamResult.value;
            responseText += chunk;
            self._streamingText = responseText;
            self.notifyStoreListeners();
            yield chunk;
            streamResult = await gen.next();
          }

          const result = streamResult.value;
          totalTokens = result.totalUsage.total;
          toolCallsExecuted = result.toolCallsExecuted.length;
          rounds = result.rounds;
        } else {
          const gen = llmOrchestrator.sendMessageStream({
            systemPrompt,
            history: self.contextManager.getHistory().slice(0, -1),
            userMessage: message,
            tools: self.getToolDefinitions(),
            signal: self._instanceAbortController.signal,
          });

          let streamResult = await gen.next();
          while (!streamResult.done) {
            const item = streamResult.value;
            if ('text' in item && typeof item.text === 'string' && item.text) {
              responseText += item.text;
              self._streamingText = responseText;
              self.notifyStoreListeners();
              yield item.text;
            }
            streamResult = await gen.next();
          }

          const result = streamResult.value;
          totalTokens = result.usage.total;
          rounds = 1;
        }

        // Add assistant turn
        self.contextManager.addTurn({
          role: 'assistant',
          content: responseText,
          timestamp: Date.now(),
        });

        // Save session
        self.contextManager.saveSession();

        self.bus.emit('llm:response-end', {
          conversationId,
          totalTokens,
        });

        self.setAgentState({ status: 'idle' });

        resolveDone({
          fullText: responseText,
          totalTokens,
          toolCallsExecuted,
          rounds,
        });
      } catch (error) {
        const err =
          error instanceof GuideKitError
            ? error
            : new GuideKitError({
                code: ErrorCodes.UNKNOWN,
                message:
                  error instanceof Error ? error.message : 'Unknown error',
                recoverable: false,
                suggestion: 'Check the console for details.',
              });

        // Privacy hook errors already set state to 'idle' and emitted 'error';
        // avoid overwriting the state or double-emitting.
        const isPrivacyHookError =
          err instanceof GuideKitError &&
          (err.code === ErrorCodes.PRIVACY_HOOK_CANCELLED || self._agentState.status === 'idle');
        if (!isPrivacyHookError) {
          self.setAgentState({ status: 'error', error: err });
          self.bus.emit('error', err);
        }
        rejectDone(err);
      } finally {
        self._sendInFlight = false;
        self._isStreaming = false;
        self._streamingText = '';
        self.notifyStoreListeners();
      }
    }

    return { stream: generate(), done };
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /** Get the current page model. */
  get pageModel(): PageModel | null {
    return this._currentPageModel;
  }

  /** Whether the SDK has been fully initialized. */
  get isReady(): boolean {
    return this._isReady;
  }

  /** Current agent state. */
  get agentState(): AgentState {
    return this._agentState;
  }

  /** Current auth token string, or null if not using token-based auth. */
  get currentToken(): string | null {
    return this.tokenManager?.token ?? null;
  }

  // -------------------------------------------------------------------------
  // Store subscription (for useSyncExternalStore)
  // -------------------------------------------------------------------------

  subscribe(listener: () => void): () => void {
    this.storeListeners.add(listener);
    return () => {
      this.storeListeners.delete(listener);
    };
  }

  getSnapshot(): GuideKitStore {
    return this._storeSnapshot;
  }

  // -------------------------------------------------------------------------
  // Custom actions
  // -------------------------------------------------------------------------

  registerAction(
    actionId: string,
    action: {
      description: string;
      parameters: Record<string, unknown>;
      handler: (params: Record<string, unknown>) => Promise<unknown>;
    },
  ): void {
    this.customActions.set(actionId, action);
  }

  // -------------------------------------------------------------------------
  // Voice control
  // -------------------------------------------------------------------------

  /** Start listening for voice input. Initializes voice pipeline on first call. */
  async startListening(): Promise<void> {
    if (!this.voicePipeline) {
      if (this._debug) {
        console.debug('[GuideKit:Core] No voice pipeline configured — cannot start listening');
      }
      return;
    }
    await this.voicePipeline.init();
    await this.voicePipeline.startListening();
  }

  /** Stop listening for voice input. */
  stopListening(): void {
    this.voicePipeline?.stopListening();
  }

  /** Stop current TTS playback (barge-in). */
  stopSpeaking(): void {
    this.voicePipeline?.stopSpeaking();
  }

  /** Whether voice pipeline is available. */
  get hasVoice(): boolean {
    return this.voicePipeline !== null;
  }

  // -------------------------------------------------------------------------
  // Visual guidance (public API)
  // -------------------------------------------------------------------------

  /** Highlight an element by sectionId or CSS selector. */
  highlight(params: {
    sectionId?: string;
    selector?: string;
    tooltip?: string;
    position?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
  }): boolean {
    if (!this.visualGuidance) return false;
    const result = this.visualGuidance.highlight(params);
    if (result) {
      this.bus.emit('visual:spotlight-shown', {
        selector: params.selector ?? params.sectionId ?? '',
        sectionId: params.sectionId,
      });
    }
    return result;
  }

  /** Dismiss the current spotlight highlight. */
  dismissHighlight(): void {
    this.visualGuidance?.dismissHighlight();
    this.bus.emit('visual:spotlight-dismissed', {});
  }

  /** Smooth scroll to a section. */
  scrollToSection(sectionId: string, offset?: number): void {
    this.visualGuidance?.scrollToSection(sectionId, offset);
  }

  /** Smooth scroll to a CSS selector. */
  scrollToSelector(selector: string, offset?: number): void {
    this.visualGuidance?.scrollToSelector(selector, offset);
  }

  /** Start a guided tour. */
  startTour(sectionIds: string[], mode?: 'auto' | 'manual'): void {
    this.visualGuidance?.startTour(sectionIds, mode);
  }

  /** Advance to next tour step. */
  nextTourStep(): void {
    this.visualGuidance?.nextTourStep();
  }

  /** Go back to previous tour step. */
  prevTourStep(): void {
    this.visualGuidance?.prevTourStep();
  }

  /** Stop the guided tour. */
  stopTour(): void {
    this.visualGuidance?.stopTour();
  }

  /** Navigate to a same-origin URL. */
  async navigate(href: string): Promise<boolean> {
    if (!this.navigationController) return false;
    return this.navigationController.navigate(href);
  }

  // -------------------------------------------------------------------------
  // Context management
  // -------------------------------------------------------------------------

  setPageContext(context: Record<string, unknown>): void {
    this.contextManager.setPageContext(context);
    if (this._debug) {
      console.debug('[GuideKit:Core] setPageContext', context);
    }
  }

  /** Get the i18n instance for localized strings. */
  get i18n(): I18n {
    return this._i18n;
  }

  /** Get/set quiet mode on proactive triggers. */
  get quietMode(): boolean {
    return this.proactiveEngine?.quietMode ?? false;
  }

  set quietMode(value: boolean) {
    if (this.proactiveEngine) {
      this.proactiveEngine.quietMode = value;
    }
    this.contextManager.quietMode = value;
  }

  /** Get/set user preference (voice/text). */
  get userPreference(): 'voice' | 'text' {
    return this.contextManager.userPreference;
  }

  set userPreference(value: 'voice' | 'text') {
    this.contextManager.userPreference = value;
  }

  /** Get the rate limiter for monitoring usage. */
  get rateLimiterState() {
    return this.rateLimiter.getState();
  }

  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------

  /**
   * Check health of all connected services.
   * Returns per-service status and an overall assessment.
   */
  async checkHealth(): Promise<HealthCheckResult> {
    const results: HealthCheckResult = {
      llm: { status: 'not-configured' },
      stt: { status: 'not-configured' },
      tts: { status: 'not-configured' },
      mic: { status: 'not-configured' },
      overall: 'ok',
    };

    // LLM check
    if (this.llmOrchestrator) {
      try {
        const start = Date.now();
        // Lightweight check — just verify the orchestrator is alive
        results.llm = {
          status: 'ok',
          latencyMs: Date.now() - start,
        };
      } catch (err) {
        results.llm = {
          status: 'unavailable',
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }

    // STT check — report as configured only if user explicitly provided STT config
    // or if voice pipeline is active (web-speech auto-default still works on demand)
    if (this._options.stt) {
      results.stt = { status: this.voicePipeline ? 'ok' : 'degraded' };
    }

    // TTS check — same logic as STT
    if (this._options.tts) {
      results.tts = { status: this.voicePipeline ? 'ok' : 'degraded' };
    }

    // Mic check
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasMic = devices.some((d) => d.kind === 'audioinput');
        results.mic = { status: hasMic ? 'ok' : 'unavailable' };
      } catch (err) {
        results.mic = {
          status: 'unavailable',
          error: err instanceof Error ? err.message : 'Permission denied',
        };
      }
    }

    // Compute overall
    const statuses = [results.llm, results.stt, results.tts, results.mic];
    const configured = statuses.filter((s) => s.status !== 'not-configured');
    if (configured.some((s) => s.status === 'unavailable')) {
      results.overall = 'unavailable';
    } else if (configured.some((s) => s.status === 'degraded')) {
      results.overall = 'degraded';
    } else {
      results.overall = 'ok';
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  async destroy(): Promise<void> {
    this._instanceAbortController.abort();
    this.contextManager.saveSession();
    SingletonGuard.release(this.instanceId);
    this._isReady = false;
    this.notifyStoreListeners();

    if (this._debug) {
      console.debug('[GuideKit:Core] Destroyed instance', this.instanceId);
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private setAgentState(state: AgentState): void {
    this._agentState = state;
    this.notifyStoreListeners();
  }

  private notifyStoreListeners(): void {
    this._storeSnapshot = this.buildSnapshot();
    for (const listener of this.storeListeners) {
      listener();
    }
  }

  private buildSnapshot(): GuideKitStore {
    return {
      status: {
        isReady: this._isReady,
        agentState: this._agentState,
        error:
          this._agentState.status === 'error'
            ? this._agentState.error
            : null,
      },
      voice: {
        isListening: this._agentState.status === 'listening',
        isSpeaking: this._agentState.status === 'speaking',
      },
      streaming: {
        isStreaming: this._isStreaming,
        streamingText: this._streamingText,
      },
    };
  }

  /**
   * Unified built-in tool specifications — single source of truth for both
   * tool definitions (sent to LLM) and handler registration.
   */
  private getBuiltinToolSpecs(): Array<ToolDefinition & { execute: (args: Record<string, unknown>) => Promise<unknown> }> {
    return [
      {
        name: 'highlight',
        description:
          'Spotlight an element on the page to draw the user\'s attention. Use sectionId to highlight a page section, or selector for a specific CSS selector. Optionally add a tooltip with explanation text.',
        parameters: {
          sectionId: { type: 'string', description: 'ID of the section to highlight' },
          selector: { type: 'string', description: 'CSS selector (overrides sectionId)' },
          tooltip: { type: 'string', description: 'Text to show in tooltip' },
          position: { type: 'string', enum: ['top', 'bottom', 'left', 'right', 'auto'], description: 'Tooltip position' },
        },
        required: [],
        schemaVersion: 1,
        execute: async (args) => {
          const sectionId = args.sectionId as string | undefined;
          const selector = args.selector as string | undefined;
          const tooltip = args.tooltip as string | undefined;
          const position = args.position as 'top' | 'bottom' | 'left' | 'right' | 'auto' | undefined;
          const result = this.highlight({ sectionId, selector, tooltip, position });
          return { success: result };
        },
      },
      {
        name: 'dismissHighlight',
        description: 'Remove the current spotlight overlay.',
        parameters: {},
        required: [],
        schemaVersion: 1,
        execute: async () => {
          this.dismissHighlight();
          return { success: true };
        },
      },
      {
        name: 'scrollToSection',
        description:
          'Smooth scroll to a section by its ID. Use offset to account for sticky headers.',
        parameters: {
          sectionId: { type: 'string', description: 'ID of the section to scroll to' },
          offset: { type: 'number', description: 'Pixel offset for sticky headers' },
        },
        required: ['sectionId'],
        schemaVersion: 1,
        execute: async (args) => {
          const sectionId = args.sectionId as string;
          const offset = args.offset as number | undefined;
          this.scrollToSection(sectionId, offset);
          return { success: true };
        },
      },
      {
        name: 'navigate',
        description:
          'Navigate to a different page within the same site. Only same-origin URLs are allowed.',
        parameters: {
          href: { type: 'string', description: 'URL or path to navigate to (same-origin only)' },
        },
        required: ['href'],
        schemaVersion: 1,
        execute: async (args) => {
          const href = args.href as string;
          const result = await this.navigate(href);
          return { success: result, navigatedTo: result ? href : null };
        },
      },
      {
        name: 'startTour',
        description:
          'Start a guided tour through multiple sections in sequence.',
        parameters: {
          sectionIds: { type: 'array', items: { type: 'string' }, description: 'Section IDs in tour order' },
          mode: { type: 'string', enum: ['auto', 'manual'], description: 'auto advances automatically; manual waits for user' },
        },
        required: ['sectionIds'],
        schemaVersion: 1,
        execute: async (args) => {
          const sectionIds = args.sectionIds as string[];
          const mode = (args.mode as 'auto' | 'manual') ?? 'manual';
          this.startTour(sectionIds, mode);
          return { success: true, steps: sectionIds.length };
        },
      },
      {
        name: 'readPageContent',
        description:
          'Read visible text content of a section by ID, or search across all sections by keyword.',
        parameters: {
          sectionId: { type: 'string', description: 'Section ID to read' },
          query: { type: 'string', description: 'Keyword to search for across sections' },
        },
        required: [],
        schemaVersion: 1,
        execute: async (args) => {
          const sectionId = args.sectionId as string | undefined;
          const query = args.query as string | undefined;
          const model = this._currentPageModel;
          if (!model) return { error: 'No page model available' };

          if (sectionId) {
            const section = model.sections.find((s) => s.id === sectionId);
            if (section) {
              const contentMapResult = await this.contextManager.getContent(sectionId);
              return {
                sectionId: section.id,
                label: section.label,
                summary: section.summary,
                contentMap: contentMapResult,
              };
            }
            return { error: `Section "${sectionId}" not found` };
          }

          if (query) {
            const queryLower = query.toLowerCase();
            const matches = model.sections.filter(
              (s) =>
                s.label?.toLowerCase().includes(queryLower) ||
                s.summary?.toLowerCase().includes(queryLower),
            );
            return {
              query,
              results: matches.slice(0, 5).map((s) => ({
                sectionId: s.id,
                label: s.label,
                snippet: s.summary?.slice(0, 200),
              })),
            };
          }

          return { error: 'Provide either sectionId or query' };
        },
      },
      {
        name: 'getVisibleSections',
        description:
          'Get the list of sections currently visible in the user viewport.',
        parameters: {},
        required: [],
        schemaVersion: 1,
        execute: async () => {
          const model = this._currentPageModel;
          if (!model) return { sections: [] };
          return {
            sections: model.sections.slice(0, 10).map((s) => ({
              id: s.id,
              label: s.label,
              selector: s.selector,
              score: s.score,
            })),
          };
        },
      },
      {
        name: 'clickElement',
        description:
          'Programmatically click an interactive element on the page.',
        parameters: {
          selector: { type: 'string', description: 'CSS selector of the element to click' },
        },
        required: ['selector'],
        schemaVersion: 1,
        execute: async (args) => {
          if (typeof document === 'undefined') return { success: false, error: 'Not in browser' };
          const selector = args.selector as string;

          const el = document.querySelector(selector);
          if (!el) return { success: false, error: `Element not found: ${selector}` };
          if (!(el instanceof HTMLElement)) return { success: false, error: 'Element is not clickable' };

          const clickableRules = this._options.options?.clickableSelectors;
          const isInDevAllowList = clickableRules?.allow?.some((pattern) => {
            try { return el.matches(pattern); } catch { return selector === pattern; }
          }) ?? false;

          if (!isInDevAllowList) {
            const defaultDenied = DEFAULT_CLICK_DENY.some((pattern) => {
              try { return el.matches(pattern); } catch { return false; }
            });
            if (defaultDenied) {
              return { success: false, error: `Selector "${selector}" matches the default deny list. Add it to clickableSelectors.allow to override.` };
            }
          }

          if (clickableRules?.deny?.length) {
            const denied = clickableRules.deny.some((pattern) => {
              try { return el.matches(pattern); } catch { return selector === pattern; }
            });
            if (denied) {
              return { success: false, error: `Selector "${selector}" is blocked by the deny list.` };
            }
          }

          if (clickableRules?.allow?.length && !isInDevAllowList) {
            return { success: false, error: `Selector "${selector}" is not in the allowed clickable selectors list.` };
          }

          el.click();
          return { success: true };
        },
      },
      {
        name: 'executeCustomAction',
        description:
          'Execute a developer-registered custom action (e.g., add to cart, submit form).',
        parameters: {
          actionId: { type: 'string', description: 'ID of the custom action' },
          params: { type: 'object', description: 'Parameters for the action' },
        },
        required: ['actionId'],
        schemaVersion: 1,
        execute: async (args) => {
          const actionId = args.actionId as string;
          const params = (args.params as Record<string, unknown>) ?? {};
          const action = this.customActions.get(actionId);
          if (!action) return { error: `Unknown action: ${actionId}` };
          try {
            const result = await action.handler(params);
            return { success: true, result };
          } catch (err) {
            return { success: false, error: err instanceof Error ? err.message : String(err) };
          }
        },
      },
    ];
  }

  /**
   * Register all built-in tool handlers with the ToolExecutor.
   * Called once during init() after VisualGuidance and all subsystems are ready.
   */
  private registerBuiltinTools(): void {
    if (!this.toolExecutor) return;
    for (const spec of this.getBuiltinToolSpecs()) {
      this.toolExecutor.registerTool({ name: spec.name, execute: spec.execute });
    }
  }

  private getToolDefinitions(): ToolDefinition[] {
    const builtinTools: ToolDefinition[] = this.getBuiltinToolSpecs().map(
      ({ execute: _execute, ...def }) => def,
    );

    // Add custom actions as individual tool definitions for better LLM discoverability
    for (const [actionId, action] of this.customActions) {
      builtinTools.push({
        name: `action_${actionId}`,
        description: action.description,
        parameters: action.parameters as Record<string, ToolParameterSchema>,
        schemaVersion: 1,
      });
    }

    return builtinTools;
  }
}
