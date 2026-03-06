import type { KnowledgeSearchOptions } from '@guidekit/core';
import type { KnowledgeStore } from './knowledge-store.js';
import { formatAttributions } from './attribution.js';

export interface KnowledgeContextProviderOptions {
  /** Max tokens to allocate for knowledge section. Default: 500. */
  tokenBudget?: number;
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
  const searchOptions = options?.searchOptions;
  const header = options?.header ?? 'Relevant Knowledge';
  const maxChars = tokenBudget * 4;

  return (query: string): string => {
    const results = store.search(query, searchOptions);
    if (results.length === 0) return '';

    const sectionHeader = `## ${header}\n\n`;
    const attributionFooter = `\n\n${formatAttributions(results)}`;
    // Reserve space for header and footer
    const reservedChars = sectionHeader.length + attributionFooter.length;
    let remaining = maxChars - reservedChars;

    const chunks: string[] = [];
    for (const result of results) {
      const entry = result.chunk.content;
      // +2 for the blank line separator between chunks
      const cost = entry.length + (chunks.length > 0 ? 2 : 0);
      if (cost > remaining) break;
      chunks.push(entry);
      remaining -= cost;
    }

    if (chunks.length === 0) return '';

    return sectionHeader + chunks.join('\n\n') + attributionFooter;
  };
}
