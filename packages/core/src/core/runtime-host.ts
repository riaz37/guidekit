import type { RuntimeInitHost } from './runtime-init.js';
import type { GuideKitCoreOptions } from './options.js';
import type { EventBus } from '../bus/index.js';
import type { ResourceManager } from '../resources/index.js';
import type { ContextManager } from '../context/index.js';
import type { AgentState, PageModel, ToolDefinition } from '../types/index.js';
import type { BuiltinToolsHost } from './builtin-tools.js';
import type { LLMOrchestrator } from '../llm/index.js';
import type { ToolExecutor } from '../llm/tool-executor.js';
import type { DOMScanner } from '../dom/index.js';
import type { TokenManager } from '../auth/token-manager.js';
import type { ConnectionManager } from '../connectivity/index.js';
import type { NavigationController } from '../navigation/index.js';
import type { VisualGuidance } from '../visual/index.js';
import type { AwarenessSystem } from '../awareness/index.js';
import type { ProactiveTriggerEngine } from '../awareness/proactive.js';
import type { VoicePipeline } from '../voice/index.js';
import type { PlatformExtensionResult } from '../pipeline/extensions.js';
import type { LLMConfig } from '../types/index.js';

export interface RuntimeHostRefs {
  instanceId: string;
  debug: boolean;
  options: GuideKitCoreOptions;
  bus: EventBus;
  resourceManager: ResourceManager;
  contextManager: ContextManager;
  toolsHost: BuiltinToolsHost;
  getAgentState: () => AgentState;
  setAgentState: (state: AgentState) => void;
  notifyStoreListeners: () => void;
  sendText: (message: string) => Promise<string>;
  resolveLLMConfig: () => LLMConfig | null;
  getToolDefinitions: () => ToolDefinition[];
  getRefs: () => {
    toolExecutor: ToolExecutor | null;
    domScanner: DOMScanner | null;
    llmOrchestrator: LLMOrchestrator | null;
    tokenManager: TokenManager | null;
    connectionManager: ConnectionManager | null;
    navigationController: NavigationController | null;
    visualGuidance: VisualGuidance | null;
    awarenessSystem: AwarenessSystem | null;
    proactiveEngine: ProactiveTriggerEngine | null;
    voicePipeline: VoicePipeline | null;
    platformExtensions: PlatformExtensionResult | null;
  };
  setRefs: (patch: Partial<{
    toolExecutor: ToolExecutor | null;
    domScanner: DOMScanner | null;
    llmOrchestrator: LLMOrchestrator | null;
    tokenManager: TokenManager | null;
    connectionManager: ConnectionManager | null;
    navigationController: NavigationController | null;
    visualGuidance: VisualGuidance | null;
    awarenessSystem: AwarenessSystem | null;
    proactiveEngine: ProactiveTriggerEngine | null;
    voicePipeline: VoicePipeline | null;
    platformExtensions: PlatformExtensionResult | null;
    pageModel: PageModel | null;
    extraToolDefinitions: ToolDefinition[];
  }>) => void;
}

export function buildRuntimeInitHost(host: RuntimeHostRefs): RuntimeInitHost {
  const refs = host.getRefs();
  // Preserve VisualNavController prototype methods (highlight, scrollToSection, …).
  // Object spread would copy only own properties and break builtin tool execution.
  return Object.assign(host.toolsHost, {
    instanceId: host.instanceId,
    debug: host.debug,
    options: host.options,
    bus: host.bus,
    resourceManager: host.resourceManager,
    contextManager: host.contextManager,
    getAgentState: host.getAgentState,
    setAgentState: host.setAgentState,
    notifyStoreListeners: host.notifyStoreListeners,
    sendText: host.sendText,
    resolveLLMConfig: host.resolveLLMConfig,
    getToolDefinitions: host.getToolDefinitions,
    toolExecutor: refs.toolExecutor,
    setToolExecutor: (e: ToolExecutor) => host.setRefs({ toolExecutor: e }),
    domScanner: refs.domScanner,
    setDomScanner: (s: DOMScanner) => host.setRefs({ domScanner: s }),
    setPageModel: (m: PageModel | null) => host.setRefs({ pageModel: m }),
    llmOrchestrator: refs.llmOrchestrator,
    setLlmOrchestrator: (o: LLMOrchestrator) => host.setRefs({ llmOrchestrator: o }),
    tokenManager: refs.tokenManager,
    setTokenManager: (m: TokenManager) => host.setRefs({ tokenManager: m }),
    connectionManager: refs.connectionManager,
    setConnectionManager: (m: ConnectionManager) => host.setRefs({ connectionManager: m }),
    navigationController: refs.navigationController,
    setNavigationController: (c: NavigationController) => host.setRefs({ navigationController: c }),
    visualGuidance: refs.visualGuidance,
    setVisualGuidance: (v: VisualGuidance) => host.setRefs({ visualGuidance: v }),
    awarenessSystem: refs.awarenessSystem,
    setAwarenessSystem: (s: AwarenessSystem) => host.setRefs({ awarenessSystem: s }),
    proactiveEngine: refs.proactiveEngine,
    setProactiveEngine: (e: ProactiveTriggerEngine) => host.setRefs({ proactiveEngine: e }),
    voicePipeline: refs.voicePipeline,
    setVoicePipeline: (p: VoicePipeline | null) => host.setRefs({ voicePipeline: p }),
    platformExtensions: refs.platformExtensions,
    setPlatformExtensions: (ext: PlatformExtensionResult) => host.setRefs({ platformExtensions: ext }),
    setExtraToolDefinitions: (tools: ToolDefinition[]) =>
      host.setRefs({ extraToolDefinitions: tools }),
  }) as RuntimeInitHost;
}
