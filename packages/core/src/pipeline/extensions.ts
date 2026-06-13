/**
 * @module @guidekit/core/pipeline/extensions
 *
 * Optional platform extensions (intelligence, knowledge, plugins).
 * Uses dynamic imports so core has no hard dependency on extension packages.
 */

import type { EventBus } from '../bus/index.js';
import type {
  AgentState,
  KnowledgeDocument,
  PageModel,
  PluginDefinition,
  SemanticPageModel,
  ToolDefinition,
} from '../types/index.js';
import type { PipelineStageHooks } from './types.js';
import { CognitiveEngine } from '../cognitive/engine.js';
import { heuristicCount } from '../context/token-budget.js';

export interface PlatformExtensionOptions {
  intelligence?: boolean | { enabled?: boolean; options?: Record<string, unknown> };
  knowledge?: {
    documents?: KnowledgeDocument[];
    engine?: 'bm25' | 'tfidf';
    topK?: number;
  };
  plugins?: PluginDefinition[];
  hallucinationGuard?: boolean;
  rootElement?: HTMLElement;
  bus?: EventBus;
  getAgentState?: () => AgentState;
  onSemanticScan?: (model: SemanticPageModel) => void;
  getToolDefinitions?: () => ToolDefinition[];
  voiceMode?: boolean;
  debug?: boolean;
}

export interface PlatformExtensionResult {
  stageHooks: PipelineStageHooks;
  pluginRegistry: PluginRegistryLike | null;
  getExtraToolDefinitions: () => ToolDefinition[];
  getExtraContextSections: () => Promise<string[]>;
  destroy: () => Promise<void>;
}

export interface PluginRegistryLike {
  install(plugin: PluginDefinition): Promise<void>;
  getRegisteredTools(): Array<{ definition: ToolDefinition }>;
  getContextProviders(): Array<{ provider: () => string | Promise<string> }>;
  getPipeline<T>(hook: string): { execute(ctx: T): Promise<T>; length: number };
  destroy(): Promise<void>;
}

function isSemanticPageModel(
  model: PageModel | SemanticPageModel,
): model is SemanticPageModel {
  return 'components' in model || 'headingOutline' in model;
}

function intelligenceEnabled(
  opt: PlatformExtensionOptions['intelligence'],
): boolean {
  if (opt === false) return false;
  if (opt === true || opt === undefined) return true;
  return opt.enabled !== false;
}

/**
 * Load optional platform packages and return pipeline stage hooks.
 */
export async function createPlatformExtensions(
  options: PlatformExtensionOptions,
): Promise<PlatformExtensionResult> {
  const stageHooks: PipelineStageHooks = {};
  let pluginRegistry: PluginRegistryLike | null = null;
  let semanticScanner: { scan(root: Element, base: PageModel): SemanticPageModel } | null =
    null;
  let knowledgeProvider: ((query: string) => string) | null = null;
  let hallucinationGuard: {
    validate(text: string, pageModel: PageModel): { confidence: number; issues: unknown[] };
  } | null = null;

  const root =
    options.rootElement ??
    (typeof document !== 'undefined' ? document.body : null);

  if (intelligenceEnabled(options.intelligence)) {
    try {
      const intel = await import('@guidekit/intelligence');
      const intelOpts =
        typeof options.intelligence === 'object'
          ? options.intelligence.options
          : undefined;
      semanticScanner = new intel.SemanticScanner(intelOpts);
      if (options.hallucinationGuard !== false) {
        hallucinationGuard = new intel.HallucinationGuard();
      }
    } catch {
      if (options.debug) {
        console.debug('[GuideKit:Core] @guidekit/intelligence not available');
      }
    }
  }

  if (options.knowledge?.documents?.length) {
    try {
      const know = await import('@guidekit/knowledge');
      const store = new know.KnowledgeStore({
        engine: options.knowledge.engine ?? 'bm25',
      });
      for (const doc of options.knowledge.documents) {
        store.addDocument(doc);
      }
      knowledgeProvider = know.createKnowledgeContextProvider(store, {
        searchOptions: { topK: options.knowledge.topK ?? 5 },
        countTokens: heuristicCount,
      });
    } catch {
      if (options.debug) {
        console.debug('[GuideKit:Core] @guidekit/knowledge not available');
      }
    }
  }

  if (options.plugins?.length) {
    try {
      const plug = await import('@guidekit/plugins');
      pluginRegistry = new plug.PluginRegistry({
        bus: options.bus as unknown as {
          on: (event: string, handler: (...args: unknown[]) => void) => () => void;
          emit: (event: string, data: unknown) => void;
        },
        getAgentState: options.getAgentState,
        debug: options.debug,
      }) as unknown as PluginRegistryLike;

      for (const plugin of options.plugins) {
        await pluginRegistry.install(plugin);
      }
    } catch {
      if (options.debug) {
        console.debug('[GuideKit:Core] @guidekit/plugins not available');
      }
    }
  }

  if (semanticScanner && root) {
    stageHooks.enrich = (ctx) => {
      const base = ctx.pageModel ?? null;
      if (!base) return ctx;
      const enriched = semanticScanner!.scan(root, base);
      options.onSemanticScan?.(enriched);
      return { ...ctx, pageModel: enriched };
    };
  }

  if (knowledgeProvider) {
    stageHooks.retrieve = (ctx) => {
      const section = knowledgeProvider!(ctx.userMessage);
      return {
        ...ctx,
        knowledgeSection: section,
        metadata: { ...ctx.metadata, sources: extractSourceLines(section) },
      };
    };
  }

  const cognitiveEngine = new CognitiveEngine({ voiceMode: options.voiceMode });
  const existingCognize = stageHooks.cognize;
  stageHooks.cognize = async (ctx) => {
    const base = existingCognize ? await existingCognize(ctx) : ctx;
    const tools = options.getToolDefinitions?.() ?? [];
    const result = cognitiveEngine.process(base.userMessage, tools);
    return {
      ...base,
      metadata: { ...base.metadata, cognitive: result },
      validation: {
        ...base.validation,
        confidence: result.confidence,
      },
    };
  };

  if (hallucinationGuard) {
    stageHooks.validate = (ctx) => {
      const pageModel = ctx.pageModel;
      if (!pageModel || !ctx.responseText) return ctx;
      const result = hallucinationGuard!.validate(ctx.responseText, pageModel);
      return {
        ...ctx,
        validation: {
          confidence: result.confidence,
          issues: result.issues,
        },
      };
    };
  }

  return {
    stageHooks,
    pluginRegistry,
    getExtraToolDefinitions: () => {
      if (!pluginRegistry) return [];
      return pluginRegistry.getRegisteredTools().map((t) => t.definition);
    },
    getExtraContextSections: async () => {
      if (!pluginRegistry) return [];
      const sections: string[] = [];
      for (const { provider } of pluginRegistry.getContextProviders()) {
        const section = await provider();
        if (section) sections.push(section);
      }
      return sections;
    },
    destroy: async () => {
      if (pluginRegistry) await pluginRegistry.destroy();
    },
  };
}

export { isSemanticPageModel };

function extractSourceLines(section: string): string[] {
  const lines = section.split('\n').filter((l) => l.startsWith('- Source:'));
  return lines.map((l) => l.replace(/^- Source:\s*/, '').trim());
}
