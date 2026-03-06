// Version
export const KNOWLEDGE_VERSION = '0.1.0';

// Classes
export { KnowledgeStore } from './knowledge-store.js';
export { BM25Index } from './bm25.js';
export { TFIDFIndex } from './tfidf.js';
export type { ScoredChunk } from './bm25.js';

// Functions
export { chunkDocument } from './chunker.js';
export { buildAttribution, formatAttributions } from './attribution.js';
export { createKnowledgeContextProvider } from './context-provider.js';
export type { KnowledgeContextProviderOptions } from './context-provider.js';

// Tokenizer
export { tokenize, removeStopwords } from './tokenizer.js';

// Re-export types from core for convenience
export type {
  KnowledgeDocument,
  KnowledgeChunk,
  SearchResult,
  SourceAttribution,
  ChunkStrategy,
  ChunkerOptions,
  SearchEngine,
  KnowledgeStoreOptions,
  KnowledgeSearchOptions,
} from '@guidekit/core';
