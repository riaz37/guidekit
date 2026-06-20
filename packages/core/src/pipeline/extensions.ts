/**
 * @module @guidekit/core/pipeline/extensions
 *
 * Optional platform extensions (intelligence, knowledge, plugins).
 * Uses dynamic imports so core has no hard dependency on extension packages.
 */

import type { EventBus } from '../bus/index.js';
import { ConfigurationError, ErrorCodes } from '../errors/index.js';
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
  /** Enable heuristic cognitive planning (@guidekit/core/cognitive). Default: false. */
  cognitive?: boolean;
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
  addKnowledgeDocument?: (doc: KnowledgeDocument) => void;
  removeKnowledgeDocument?: (id: string) => void;
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
  if (opt === true) return true;
  if (opt === undefined) return false;
  return opt.enabled !== false;
}

function platformImportError(packageName: string): ConfigurationError {
  return new ConfigurationError({
    code: ErrorCodes.PLUGIN_DEPENDENCY_MISSING,
    message: `@guidekit/${packageName} is required for the configured Platform Mode options but is not installed.`,
    suggestion: `Run: npm install @guidekit/${packageName}`,
  });
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
  let knowledgeStore: {
    addDocument(doc: KnowledgeDocument): void;
    removeDocument(id: string): void;
  } | null = null;
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
      throw platformImportError('intelligence');
    }
  }

  if (options.knowledge !== undefined) {
    try {
      const know = await import('@guidekit/knowledge');
      const store = new know.KnowledgeStore({
        engine: options.knowledge.engine ?? 'bm25',
      });
      knowledgeStore = store;
      const documents = options.knowledge.documents ?? [];
      for (const doc of documents) {
        store.addDocument(doc);
      }
      knowledgeProvider = know.createKnowledgeContextProvider(store, {
        searchOptions: { topK: options.knowledge.topK ?? 5 },
        countTokens: heuristicCount,
      });
    } catch {
      throw platformImportError('knowledge');
    }
  }

  if (options.plugins !== undefined) {
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
    } catch (err) {
      if (err instanceof ConfigurationError) throw err;
      throw platformImportError('plugins');
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

  if (options.cognitive === true) {
    const cognitiveEngine = new CognitiveEngine({ voiceMode: options.voiceMode });
    const existingCognize = stageHooks.cognize;
    stageHooks.cognize = async (ctx) => {
      const base = existingCognize ? await existingCognize(ctx) : ctx;
      const tools = options.getToolDefinitions?.() ?? [];
      const result = cognitiveEngine.process(base.userMessage, tools);
      return {
        ...base,
        metadata: { ...base.metadata, cognitive: result },
      };
    };
  }

  if (hallucinationGuard) {
    stageHooks.validate = (ctx) => {
      const pageModel = ctx.pageModel;
      if (!pageModel || !ctx.responseText) return ctx;
      const result = hallucinationGuard!.validate(ctx.responseText, pageModel);
      let responseText = ctx.responseText;
      let corrected = false;

      const highIssues = result.issues.filter(
        (issue) =>
          typeof issue === 'object' &&
          issue !== null &&
          'severity' in issue &&
          (issue as { severity: string }).severity === 'high',
      );

      if (highIssues.length > 0) {
        const suggestions = highIssues
          .map((issue) =>
            typeof issue === 'object' && issue !== null && 'suggestion' in issue
              ? String((issue as { suggestion: string }).suggestion)
              : '',
          )
          .filter(Boolean)
          .join(' ');
        responseText = `${responseText}\n\n(I could not verify every UI reference on this page. ${suggestions})`;
        corrected = true;
        options.bus?.emit('validation:corrected', { issues: highIssues });
      }

      return {
        ...ctx,
        responseText,
        validation: {
          confidence: result.confidence,
          issues: result.issues,
          corrected,
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
    addKnowledgeDocument: knowledgeStore
      ? (doc) => knowledgeStore!.addDocument(doc)
      : undefined,
    removeKnowledgeDocument: knowledgeStore
      ? (id) => knowledgeStore!.removeDocument(id)
      : undefined,
    destroy: async () => {
      if (pluginRegistry) await pluginRegistry.destroy();
    },
  };
}

function extractSourceLines(section: string): string[] {
  const lines = section.split('\n');
  return lines.filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
}

export { isSemanticPageModel };
