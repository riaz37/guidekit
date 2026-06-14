/** Ambient types for optional platform packages (dynamic import at runtime). */
declare module '@guidekit/intelligence' {
  export class SemanticScanner {
    constructor(options?: Record<string, unknown>);
    scan(root: Element, base: import('./types/index.js').PageModel): import('./types/index.js').SemanticPageModel;
  }
  export class HallucinationGuard {
    validate(
      text: string,
      pageModel: import('./types/index.js').PageModel,
    ): { confidence: number; issues: unknown[] };
  }
}

declare module '@guidekit/knowledge' {
  export class KnowledgeStore {
    constructor(options?: { engine?: 'bm25' | 'tfidf' });
    addDocument(doc: import('./types/index.js').KnowledgeDocument): void;
    removeDocument(id: string): void;
    search(query: string, options?: { topK?: number }): Array<{ chunk: { content: string } }>;
  }
  export function createKnowledgeContextProvider(
    store: KnowledgeStore,
    options?: {
      tokenBudget?: number;
      countTokens?: (text: string) => number;
      searchOptions?: { topK?: number };
      header?: string;
    },
  ): (query: string) => string;
}

declare module '@guidekit/plugins' {
  import type { PluginDefinition } from './types/index.js';
  export class PluginRegistry {
    constructor(options: Record<string, unknown>);
    install(plugin: PluginDefinition): Promise<void>;
    getRegisteredTools(): Array<{ definition: import('./types/index.js').ToolDefinition }>;
    getContextProviders(): Array<{ provider: () => string | Promise<string> }>;
    getPipeline<T>(hook: string): { execute(ctx: T): Promise<T>; length: number };
    destroy(): Promise<void>;
  }
}
