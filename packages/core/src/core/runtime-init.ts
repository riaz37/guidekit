/**
 * Browser runtime initialization extracted from GuideKitCore.
 */

import { DOMScanner } from '../dom/index.js';
import { LLMOrchestrator } from '../llm/index.js';
import { ToolExecutor } from '../llm/tool-executor.js';
import { ConnectionManager } from '../connectivity/index.js';
import { NavigationController } from '../navigation/index.js';
import { VoicePipeline, type VoicePipelineOptions } from '../voice/index.js';
import { WebSpeechSTT } from '../voice/web-speech-stt.js';
import { VisualGuidance } from '../visual/index.js';
import { AwarenessSystem } from '../awareness/index.js';
import { ProactiveTriggerEngine } from '../awareness/proactive.js';
import { TokenManager } from '../auth/token-manager.js';
import { ConfigurationError, ErrorCodes } from '../errors/index.js';
import { createPlatformExtensions } from '../pipeline/extensions.js';
import type { PlatformExtensionResult } from '../pipeline/extensions.js';
import { resolveSttConfig, resolveTtsConfig } from './voice-config.js';
import type {
  LLMConfig,
  AgentState,
  PageModel,
  ToolDefinition,
} from '../types/index.js';
import type { EventBus } from '../bus/index.js';
import type { ContextManager } from '../context/index.js';
import type { ResourceManager } from '../resources/index.js';
import { registerBuiltinTools, type BuiltinToolsHost } from './builtin-tools.js';
import type { GuideKitCoreOptions } from './options.js';

export interface RuntimeInitHost extends BuiltinToolsHost {
  instanceId: string;
  debug: boolean;
  options: GuideKitCoreOptions;
  bus: EventBus;
  resourceManager: ResourceManager;
  contextManager: ContextManager;
  getAgentState: () => AgentState;
  setAgentState: (state: AgentState) => void;
  notifyStoreListeners: () => void;
  sendText: (message: string) => Promise<string>;
  resolveLLMConfig: () => LLMConfig | null;
  toolExecutor: ToolExecutor | null;
  setToolExecutor: (executor: ToolExecutor) => void;
  domScanner: DOMScanner | null;
  setDomScanner: (scanner: DOMScanner) => void;
  setPageModel: (model: PageModel | null) => void;
  llmOrchestrator: LLMOrchestrator | null;
  setLlmOrchestrator: (orchestrator: LLMOrchestrator) => void;
  tokenManager: TokenManager | null;
  setTokenManager: (manager: TokenManager) => void;
  connectionManager: ConnectionManager | null;
  setConnectionManager: (manager: ConnectionManager) => void;
  navigationController: NavigationController | null;
  setNavigationController: (controller: NavigationController) => void;
  visualGuidance: VisualGuidance | null;
  setVisualGuidance: (guidance: VisualGuidance) => void;
  awarenessSystem: AwarenessSystem | null;
  setAwarenessSystem: (system: AwarenessSystem) => void;
  proactiveEngine: ProactiveTriggerEngine | null;
  setProactiveEngine: (engine: ProactiveTriggerEngine) => void;
  voicePipeline: VoicePipeline | null;
  setVoicePipeline: (pipeline: VoicePipeline | null) => void;
  platformExtensions: PlatformExtensionResult | null;
  setPlatformExtensions: (ext: PlatformExtensionResult) => void;
  setExtraToolDefinitions: (tools: ToolDefinition[]) => void;
  getToolDefinitions: () => ToolDefinition[];
}

export async function initializeGuideKitRuntime(host: RuntimeInitHost): Promise<void> {
  const { options, debug } = host;

  if (!options.llm && !options.tokenEndpoint) {
    throw new ConfigurationError({
      code: ErrorCodes.CONFIG_MISSING_REQUIRED,
      message: 'Either tokenEndpoint or llm config must be provided.',
      suggestion:
        'Add tokenEndpoint="/api/guidekit/token" or llm={{ provider: "gemini", apiKey: "..." }} to GuideKitProvider.',
    });
  }

  if (options.tokenEndpoint) {
    const tokenManager = new TokenManager({
      tokenEndpoint: options.tokenEndpoint,
      instanceId: host.instanceId,
      bus: host.bus,
      debug,
    });
    await tokenManager.start();
    host.setTokenManager(tokenManager);
    if (!options.llm && !options.proxy?.llm) {
      console.warn(
        '[GuideKit] tokenEndpoint provided without llm config or proxy.llm. ' +
          'Add proxy={{ llm: "/api/guidekit/llm" }} and llm={{ provider: "gemini" }} for production.',
      );
    }
    host.resourceManager.register({
      name: 'token-manager',
      cleanup: () => tokenManager.destroy(),
    });
  }

  const domScanner = new DOMScanner({
    rootElement: options.rootElement,
    debug,
  });
  host.setDomScanner(domScanner);

  const initialModel = domScanner.scan();
  host.setPageModel(initialModel);
  host.bus.emit('dom:scan-complete', { pageModel: initialModel, durationMs: 0 });

  const unobserve = domScanner.observe((model) => {
    host.setPageModel(model);
    host.bus.emit('dom:scan-complete', { pageModel: model, durationMs: 0 });
    host.notifyStoreListeners();
  });
  host.resourceManager.register({ name: 'dom-observer', cleanup: unobserve });

  const resolvedLlmConfig = host.resolveLLMConfig();
  if (resolvedLlmConfig) {
    const llmOrchestrator = new LLMOrchestrator({
      config: resolvedLlmConfig,
      debug,
      onChunk: (chunk) => host.bus.emit('llm:response-chunk', chunk),
      onToolCall: (toolCall) => host.bus.emit('llm:tool-call', toolCall),
      onTokenUsage: (usage) => host.bus.emit('llm:token-usage', usage),
      onError: (error) => host.bus.emit('error', error),
    });
    host.setLlmOrchestrator(llmOrchestrator);
  }

  const connectionManager = new ConnectionManager({
    healthEndpoint:
      options.proxy?.health ??
      (options.tokenEndpoint
        ? options.tokenEndpoint.replace(/\/token$/, '/health')
        : undefined),
    debug,
  });
  connectionManager.onStateChange((state, previous) => {
    host.bus.emit('connectivity:state-change', { state, previous });
  });
  connectionManager.start();
  host.setConnectionManager(connectionManager);
  host.resourceManager.register({
    name: 'connection-manager',
    cleanup: () => connectionManager.stop(),
  });

  const navigationController = new NavigationController({
    debug,
    router: options.navigation?.router,
  });
  navigationController.onRouteChange((from, to) => {
    host.bus.emit('dom:route-change', { from, to });
    host.contextManager.clearPageMemory();
    if (host.domScanner) {
      setTimeout(() => {
        const model = host.domScanner!.scan();
        host.setPageModel(model);
        host.bus.emit('dom:scan-complete', { pageModel: model, durationMs: 0 });
        host.notifyStoreListeners();
      }, 100);
    }
  });
  navigationController.start();
  host.setNavigationController(navigationController);
  host.resourceManager.register({
    name: 'navigation-controller',
    cleanup: () => navigationController.stop(),
  });

  const visualGuidance = new VisualGuidance({
    spotlightColor: options.options?.spotlightColor,
    debug,
  });
  visualGuidance.onTourStep((stepIndex, totalSteps, sectionId) => {
    host.bus.emit('visual:tour-step', { stepIndex, totalSteps, sectionId });
  });
  host.setVisualGuidance(visualGuidance);
  host.resourceManager.register({
    name: 'visual-guidance',
    cleanup: () => visualGuidance.destroy(),
  });

  const awarenessSystem = new AwarenessSystem({
    bus: host.bus,
    rootElement: options.rootElement,
    debug,
  });
  awarenessSystem.start();
  host.setAwarenessSystem(awarenessSystem);
  host.resourceManager.register({
    name: 'awareness-system',
    cleanup: () => awarenessSystem.destroy(),
  });

  const proactiveEngine = new ProactiveTriggerEngine({
    bus: host.bus,
    debug,
    onTrigger: (trigger) => {
      if (debug) {
        console.debug('[GuideKit:Core] Proactive trigger:', trigger.type, trigger);
      }
      options.onEvent?.({
        type: `proactive:${trigger.type}`,
        data: trigger as unknown as Record<string, unknown>,
        timestamp: trigger.timestamp,
      });
    },
  });
  proactiveEngine.start();
  host.setProactiveEngine(proactiveEngine);
  host.resourceManager.register({
    name: 'proactive-engine',
    cleanup: () => proactiveEngine.destroy(),
  });

  await host.contextManager.initTokenBudget();

  await initVoicePipeline(host);

  const session = host.contextManager.restoreSession();
  if (session && debug) {
    console.debug(
      '[GuideKit:Core] Restored session with',
      session.conversationHistory.length,
      'turns',
    );
  }

  const platformExtensions = await createPlatformExtensions({
    intelligence: options.intelligence,
    knowledge: options.knowledge,
    plugins: options.plugins,
    cognitive: options.cognitive,
    hallucinationGuard: options.hallucinationGuard,
    rootElement: options.rootElement,
    bus: host.bus,
    getAgentState: host.getAgentState,
    getToolDefinitions: () => host.getToolDefinitions(),
    voiceMode: host.contextManager.userPreference === 'voice',
    onSemanticScan: (model) => {
      host.proactiveEngine?.evaluateSemanticPage?.(model);
    },
    debug,
  });
  host.setPlatformExtensions(platformExtensions);
  host.setExtraToolDefinitions(platformExtensions.getExtraToolDefinitions());

  const pluginRegistry = platformExtensions.pluginRegistry;
  const lastToolArgs = new Map<string, Record<string, unknown>>();

  const toolExecutor = new ToolExecutor({
    maxRounds: 5,
    debug,
    onToolCall: (name, args) => {
      lastToolArgs.set(name, args);
      if (pluginRegistry?.getPipeline('beforeToolExecution').length) {
        void pluginRegistry.getPipeline('beforeToolExecution').execute({
          toolName: name,
          arguments: args,
          metadata: {},
        });
      }
      host.bus.emit('llm:tool-call', { name, arguments: args });
    },
    onToolResult: (name, result, durationMs) => {
      const args = lastToolArgs.get(name) ?? {};
      if (pluginRegistry?.getPipeline('afterToolExecution').length) {
        void pluginRegistry.getPipeline('afterToolExecution').execute({
          toolName: name,
          arguments: args,
          result,
          durationMs,
          metadata: {},
        });
      }
      lastToolArgs.delete(name);
    },
  });
  host.setToolExecutor(toolExecutor);
  registerBuiltinTools(host, toolExecutor);

  if (platformExtensions.pluginRegistry) {
    host.resourceManager.register({
      name: 'plugin-registry',
      cleanup: () => platformExtensions.destroy(),
    });
  }
}

async function initVoicePipeline(host: RuntimeInitHost): Promise<void> {
  const { options, debug } = host;
  const getToken = () => host.tokenManager?.token ?? null;
  const refreshSession = host.tokenManager
    ? async () => {
        await host.tokenManager!.refresh();
      }
    : undefined;

  const sttConfig = await resolveSttConfig(
    options,
    host.tokenManager !== null,
    getToken,
    refreshSession,
  );
  const ttsConfig = await resolveTtsConfig(
    options,
    host.tokenManager !== null,
    getToken,
    refreshSession,
  );

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
    if (typeof window !== 'undefined' && !WebSpeechSTT.isSupported()) {
      host.setVoicePipeline(null);
      if (debug) {
        console.debug(
          '[GuideKit:Core] Web Speech STT is not supported in this browser — voice disabled',
        );
      }
      return;
    }
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
    const voicePipeline = new VoicePipeline({
      sttConfig: voiceSttConfig,
      ttsConfig: voiceTtsConfig,
      debug,
    });

    voicePipeline.onStateChange((state, previous) => {
      host.bus.emit('voice:state-change', { from: previous, to: state });
      switch (state) {
        case 'listening':
          host.setAgentState({ status: 'listening', durationMs: 0 });
          break;
        case 'speaking':
          host.setAgentState({ status: 'speaking', utterance: '' });
          break;
        case 'idle':
          if (host.getAgentState().status !== 'processing') {
            host.setAgentState({ status: 'idle' });
          }
          break;
      }
    });

    voicePipeline.onTranscript((text, isFinal) => {
      // Bus + widget updates are handled in VoicePipeline._handleTranscript
      if (isFinal && text.trim()) {
        void voicePipeline.processTranscript(text, (t) => host.sendText(t));
      }
    });

    host.setVoicePipeline(voicePipeline);
    host.resourceManager.register({
      name: 'voice-pipeline',
      cleanup: () => voicePipeline.destroy(),
    });
  } catch {
    host.setVoicePipeline(null);
    if (debug) {
      console.debug('[GuideKit:Core] Voice pipeline unavailable in this environment');
    }
  }
}
