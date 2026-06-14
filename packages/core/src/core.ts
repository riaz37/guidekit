// ---------------------------------------------------------------------------
// GuideKit SDK – Core Orchestrator (facade)
// ---------------------------------------------------------------------------

import { EventBus, createEventBus } from './bus/index.js';
import { ResourceManager, SingletonGuard } from './resources/index.js';
import { ContextManager } from './context/index.js';
import type { LLMOrchestrator } from './llm/index.js';
import type { ToolExecutor } from './llm/tool-executor.js';
import type { ConnectionManager } from './connectivity/index.js';
import type { NavigationController } from './navigation/index.js';
import type { VoicePipeline } from './voice/index.js';
import type { VisualGuidance } from './visual/index.js';
import type { AwarenessSystem } from './awareness/index.js';
import type { ProactiveTriggerEngine } from './awareness/proactive.js';
import { RateLimiter } from './llm/rate-limiter.js';
import { I18n, type LocaleInput } from './i18n/index.js';
import type { TokenManager } from './auth/token-manager.js';
import type { PipelineOrchestrator } from './pipeline/index.js';
import type { PlatformExtensionResult } from './pipeline/extensions.js';
import { PipelineTelemetry } from './telemetry/index.js';
import { collectToolDefinitions, type BuiltinToolsHost } from './core/builtin-tools.js';
import { runHealthCheck, type HealthCheckResult } from './core/health-check.js';
import { resolveLLMConfig } from './core/llm-config.js';
import { initializeGuideKitRuntime } from './core/runtime-init.js';
import { buildRuntimeInitHost } from './core/runtime-host.js';
import { setupPipelineOrchestrator } from './core/pipeline-setup.js';
import { VisualNavController } from './core/visual-nav.js';
import { VoiceController } from './core/voice-control.js';
import { StoreSync } from './core/store-sync.js';
import type { GuideKitCoreOptions } from './core/options.js';
import type {
  ToolDefinition,
  AgentState,
  GuideKitStore,
  TextStream,
  PageModel,
} from './types/index.js';
import { GuideKitError, ConfigurationError, ErrorCodes } from './errors/index.js';

export type { GuideKitCoreOptions } from './core/options.js';
export type { HealthCheckStatus, HealthCheckResult } from './core/health-check.js';
export type { BeforeLLMCallContext } from './pipeline/types.js';

export class GuideKitCore {
  readonly instanceId: string;
  readonly bus: EventBus;

  private resourceManager: ResourceManager;
  private domScanner: import('./dom/index.js').DOMScanner | null = null;
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
  private pipeline: PipelineOrchestrator | null = null;
  private platformExtensions: PlatformExtensionResult | null = null;
  private extraToolDefinitions: ToolDefinition[] = [];
  private readonly pipelineTelemetry = new PipelineTelemetry();
  private readonly visualNav: VisualNavController;
  private readonly voiceControl: VoiceController;
  private readonly storeSync: StoreSync;

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
  private _busUnsubs: Array<() => void> = [];

  private customActions = new Map<
    string,
    {
      description: string;
      parameters: Record<string, unknown>;
      handler: (params: Record<string, unknown>) => Promise<unknown>;
    }
  >();

  constructor(options: GuideKitCoreOptions) {
    this._options = options;
    this.instanceId = options.instanceId ?? 'default';
    this._debug = options.options?.debug ?? false;
    this.bus = createEventBus({ debug: this._debug });
    this.resourceManager = SingletonGuard.acquire(
      this.instanceId,
      () => new ResourceManager(this.instanceId),
    );
    this.contextManager = new ContextManager({
      agent: options.agent,
      contentMap: options.contentMap,
      debug: this._debug,
    });
    const mode = options.options?.mode;
    if (mode === 'voice' || mode === 'text') {
      this.contextManager.userPreference = mode;
    }
    this.rateLimiter = new RateLimiter({
      bus: this.bus,
      limits: options.options?.rateLimits,
      debug: this._debug,
    });
    this._i18n = new I18n({
      locale: (options.options?.locale as LocaleInput) ?? 'auto',
      debug: this._debug,
    });
    this.visualNav = new VisualNavController(
      this.bus,
      () => this.visualGuidance,
      () => this.navigationController,
    );
    this.voiceControl = new VoiceController(this._debug, () => this.voicePipeline);
    this.storeSync = new StoreSync(() => ({
      isReady: this._isReady,
      agentState: this._agentState,
      isStreaming: this._isStreaming,
      streamingText: this._streamingText,
    }));

    if (options.onError) {
      this._busUnsubs.push(
        this.bus.on('error', (err) => {
          if (err instanceof GuideKitError) options.onError!(err);
        }),
      );
    }
    if (options.onEvent) {
      this._busUnsubs.push(
        this.bus.onAny((data, eventName) => {
          options.onEvent!({
            type: eventName,
            data: typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {},
            timestamp: Date.now(),
          });
        }),
      );
    }
  }

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
    if (this._instanceAbortController.signal.aborted) {
      this._instanceAbortController = new AbortController();
    }
    await initializeGuideKitRuntime(
      buildRuntimeInitHost({
        instanceId: this.instanceId,
        debug: this._debug,
        options: this._options,
        bus: this.bus,
        resourceManager: this.resourceManager,
        contextManager: this.contextManager,
        toolsHost: this.getToolsHost(),
        getAgentState: () => this._agentState,
        setAgentState: (s) => this.setAgentState(s),
        notifyStoreListeners: () => this.notifyStoreListeners(),
        sendText: (m) => this.sendText(m),
        resolveLLMConfig: () =>
          resolveLLMConfig(
            this._options,
            this.tokenManager !== null,
            () => this.tokenManager?.token ?? null,
          ),
        getToolDefinitions: () => this.getToolDefinitions(),
        getRefs: () => ({
          toolExecutor: this.toolExecutor,
          domScanner: this.domScanner,
          llmOrchestrator: this.llmOrchestrator,
          tokenManager: this.tokenManager,
          connectionManager: this.connectionManager,
          navigationController: this.navigationController,
          visualGuidance: this.visualGuidance,
          awarenessSystem: this.awarenessSystem,
          proactiveEngine: this.proactiveEngine,
          voicePipeline: this.voicePipeline,
          platformExtensions: this.platformExtensions,
        }),
        setRefs: (patch) => {
          if (patch.toolExecutor !== undefined) this.toolExecutor = patch.toolExecutor;
          if (patch.domScanner !== undefined) this.domScanner = patch.domScanner;
          if (patch.llmOrchestrator !== undefined) this.llmOrchestrator = patch.llmOrchestrator;
          if (patch.tokenManager !== undefined) this.tokenManager = patch.tokenManager;
          if (patch.connectionManager !== undefined) this.connectionManager = patch.connectionManager;
          if (patch.navigationController !== undefined) {
            this.navigationController = patch.navigationController;
          }
          if (patch.visualGuidance !== undefined) this.visualGuidance = patch.visualGuidance;
          if (patch.awarenessSystem !== undefined) this.awarenessSystem = patch.awarenessSystem;
          if (patch.proactiveEngine !== undefined) this.proactiveEngine = patch.proactiveEngine;
          if (patch.voicePipeline !== undefined) this.voicePipeline = patch.voicePipeline;
          if (patch.platformExtensions !== undefined) {
            this.platformExtensions = patch.platformExtensions;
          }
          if (patch.pageModel !== undefined) this._currentPageModel = patch.pageModel;
          if (patch.extraToolDefinitions !== undefined) {
            this.extraToolDefinitions = patch.extraToolDefinitions;
          }
        },
      }),
    );
    this.resourceManager.markReady();
    this._isReady = true;
    this.pipeline = this.createPipelineOrchestrator();
    this.notifyStoreListeners();
    this._options.onReady?.();
    if (this._debug) {
      console.debug('[GuideKit:Core] Initialized', {
        instanceId: this.instanceId,
        sections: this._currentPageModel?.sections.length,
      });
    }
  }

  async sendText(message: string): Promise<string> {
    const { stream, done } = this.sendTextStream(message);
    done.catch(() => {});
    for await (const _ of stream) { /* drive completion */ }
    return (await done).fullText;
  }

  sendTextStream(message: string): TextStream {
    if (!this.pipeline) {
      throw new ConfigurationError({
        code: ErrorCodes.CONFIG_MISSING_REQUIRED,
        message: 'SDK not initialized.',
        suggestion: 'Call init() before sending messages.',
      });
    }
    return this.pipeline.sendTextStream(message);
  }

  get pageModel(): PageModel | null {
    return this._currentPageModel;
  }
  get isReady(): boolean {
    return this._isReady;
  }
  get agentState(): AgentState {
    return this._agentState;
  }
  get currentToken(): string | null {
    return this.tokenManager?.token ?? null;
  }

  subscribe(listener: () => void): () => void {
    return this.storeSync.subscribe(listener);
  }
  getSnapshot(): GuideKitStore {
    return this.storeSync.getSnapshot();
  }

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

  /** Add a document to the knowledge store (requires Platform Mode knowledge). */
  addKnowledgeDocument(doc: import('./types/index.js').KnowledgeDocument): void {
    if (!this.platformExtensions?.addKnowledgeDocument) {
      throw new ConfigurationError({
        code: ErrorCodes.CONFIG_MISSING_REQUIRED,
        message: 'Knowledge store is not configured.',
        suggestion: 'Enable knowledge={{ documents: [...] }} on GuideKitProvider.',
      });
    }
    this.platformExtensions.addKnowledgeDocument(doc);
  }

  /** Remove a document from the knowledge store by id. */
  removeKnowledgeDocument(documentId: string): void {
    if (!this.platformExtensions?.removeKnowledgeDocument) {
      throw new ConfigurationError({
        code: ErrorCodes.CONFIG_MISSING_REQUIRED,
        message: 'Knowledge store is not configured.',
        suggestion: 'Enable knowledge={{ documents: [...] }} on GuideKitProvider.',
      });
    }
    this.platformExtensions.removeKnowledgeDocument(documentId);
  }

  startListening(): Promise<void> {
    return this.voiceControl.startListening();
  }
  stopListening(): void {
    this.voiceControl.stopListening();
  }
  stopSpeaking(): void {
    this.voiceControl.stopSpeaking();
  }
  get hasVoice(): boolean {
    return this.voiceControl.hasVoice;
  }

  /** Highlight an element by sectionId or CSS selector. */
  highlight(params: {
    sectionId?: string;
    selector?: string;
    tooltip?: string;
    position?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
  }): boolean {
    return this.visualNav.highlight(params);
  }

  dismissHighlight(): void {
    this.visualNav.dismissHighlight();
  }

  scrollToSection(sectionId: string, offset?: number): void {
    this.visualNav.scrollToSection(sectionId, offset);
  }

  scrollToSelector(selector: string, offset?: number): void {
    this.visualNav.scrollToSelector(selector, offset);
  }

  startTour(sectionIds: string[], mode?: 'auto' | 'manual'): void {
    this.visualNav.startTour(sectionIds, mode);
  }

  nextTourStep(): void {
    this.visualNav.nextTourStep();
  }

  prevTourStep(): void {
    this.visualNav.prevTourStep();
  }

  stopTour(): void {
    this.visualNav.stopTour();
  }

  async navigate(href: string): Promise<boolean> {
    return this.visualNav.navigate(href);
  }

  setPageContext(context: Record<string, unknown>): void {
    this.contextManager.setPageContext(context);
    if (this._debug) console.debug('[GuideKit:Core] setPageContext', context);
  }
  get i18n(): I18n {
    return this._i18n;
  }
  get quietMode(): boolean {
    return this.proactiveEngine?.quietMode ?? false;
  }
  set quietMode(value: boolean) {
    if (this.proactiveEngine) this.proactiveEngine.quietMode = value;
    this.contextManager.quietMode = value;
  }
  get userPreference(): 'voice' | 'text' {
    return this.contextManager.userPreference;
  }
  set userPreference(value: 'voice' | 'text') {
    this.contextManager.userPreference = value;
  }
  get rateLimiterState() {
    return this.rateLimiter.getState();
  }

  async checkHealth(): Promise<HealthCheckResult> {
    return runHealthCheck({
      llmOrchestrator: this.llmOrchestrator,
      voicePipeline: this.voicePipeline,
      stt: this._options.stt,
      tts: this._options.tts,
    });
  }

  async destroy(): Promise<void> {
    for (const unsub of this._busUnsubs) unsub();
    this._busUnsubs = [];
    this.bus.removeAll();
    this._instanceAbortController.abort();
    this._initPromise = null;
    this.contextManager.saveSession();
    await this.resourceManager.destroy();
    SingletonGuard.release(this.instanceId);
    this._isReady = false;
    this.notifyStoreListeners();
    if (this._debug) console.debug('[GuideKit:Core] Destroyed instance', this.instanceId);
  }

  getTelemetrySpans(): ReturnType<PipelineTelemetry['toJSON']> {
    return this.pipelineTelemetry.toJSON();
  }

  private createPipelineOrchestrator(): PipelineOrchestrator {
    return setupPipelineOrchestrator({
      llmOrchestrator: this.llmOrchestrator,
      toolExecutor: this.toolExecutor,
      contextManager: this.contextManager,
      rateLimiter: this.rateLimiter,
      bus: this.bus,
      signal: this._instanceAbortController.signal,
      maxMessageLength: this._options.options?.maxMessageLength ?? 10_000,
      isReady: () => this._isReady && this.llmOrchestrator !== null,
      getSendInFlight: () => this._sendInFlight,
      setSendInFlight: (v) => {
        this._sendInFlight = v;
      },
      getPageModel: () => this._currentPageModel,
      getToolDefinitions: () => this.getToolDefinitions(),
      platformExtensions: this.platformExtensions,
      pipelineHooks: this._options.pipelineHooks,
      onBeforeLLMCall: this._options.onBeforeLLMCall,
      setAgentState: (s) => this.setAgentState(s),
      getAgentState: () => this._agentState,
      setStreaming: (isStreaming, text) => {
        this._isStreaming = isStreaming;
        this._streamingText = text;
      },
      notifyListeners: () => this.notifyStoreListeners(),
      telemetry: this.pipelineTelemetry,
    });
  }

  private getToolsHost(): BuiltinToolsHost {
    return Object.assign(this.visualNav, {
      getPageModel: () => this._currentPageModel,
      contextManager: this.contextManager,
      customActions: this.customActions,
      clickableSelectors: this._options.options?.clickableSelectors,
    });
  }

  private getToolDefinitions(): ToolDefinition[] {
    return collectToolDefinitions(this.getToolsHost(), this.extraToolDefinitions);
  }

  private setAgentState(state: AgentState): void {
    this._agentState = state;
    this.notifyStoreListeners();
  }

  private notifyStoreListeners(): void {
    this.storeSync.notify();
  }
}
