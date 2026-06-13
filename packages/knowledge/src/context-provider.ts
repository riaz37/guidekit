import type { KnowledgeSearchOptions } from '@guidekit/core';
import type { KnowledgeStore } from './knowledge-store.js';
import { formatAttributions } from './attribution.js';

export interface KnowledgeContextProviderOptions {
  /** Max tokens to allocate for knowledge section. Default: 500. */
  tokenBudget?: number;
  /** Token counter (from @guidekit/core TokenBudgetManager.count). Falls back to char/4. */
  countTokens?: (text: string) => number;
  /** Search options to use. */
  searchOptions?: KnowledgeSearchOptions;
  /** Header for the knowledge section. Default: "Relevant Knowledge" */
  header?: string;
}

/**
 * Create a context provider function that searches a KnowledgeStore
 * and returns formatted results for LLM system prompt injection.
 */
export function createKnowledgeContextProvider(
  store: KnowledgeStore,
  options?: KnowledgeContextProviderOptions,
): (query: string) => string {
  const tokenBudget = options?.tokenBudget ?? 500;
  const countTokens = options?.countTokens ?? ((text: string) => Math.ceil(text.length / 4));
  const searchOptions = options?.searchOptions;
  const header = options?.header ?? 'Relevant Knowledge';

  return (query: string): string => {
    const results = store.search(query, searchOptions);
    if (results.length === 0) return '';

    const sectionHeader = `## ${header}\n\n`;
    const attributionFooter = `\n\n${formatAttributions(results)}`;
    const headerTokens = countTokens(sectionHeader);
    const footerTokens = countTokens(attributionFooter);
    let remainingTokens = tokenBudget - headerTokens - footerTokens;

    const chunks: string[] = [];
    for (const result of results) {
      const entry = result.chunk.content;
      const separator = chunks.length > 0 ? '\n\n' : '';
      const cost = countTokens(separator + entry);
      if (cost > remainingTokens) break;
      chunks.push(entry);
      remainingTokens -= cost;
    }

    if (chunks.length === 0) return '';

    return sectionHeader + chunks.join('\n\n') + attributionFooter;
  };
}
