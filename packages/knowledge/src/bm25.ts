import type { KnowledgeChunk } from '@guidekit/core';
import { tokenize, removeStopwords } from './tokenizer.js';

export interface ScoredChunk {
  chunk: KnowledgeChunk;
  score: number;
}

interface BM25Options {
  k1?: number;
  b?: number;
}

export class BM25Index {
  private readonly k1: number;
  private readonly b: number;

  /** Inverted index: term -> (chunkId -> frequency) */
  private readonly invertedIndex = new Map<string, Map<string, number>>();
  /** Document length in tokens per chunk */
  private readonly docLengths = new Map<string, number>();
  /** Stored chunks */
  private readonly chunks = new Map<string, KnowledgeChunk>();
  /** Track which chunks belong to which document */
  private readonly docToChunks = new Map<string, Set<string>>();
  /** Running total of all document lengths for avgdl computation */
  private totalDocLength = 0;

  constructor(options?: BM25Options) {
    this.k1 = options?.k1 ?? 1.2;
    this.b = options?.b ?? 0.75;
  }

  /** Add chunks from a document to the index. */
  addDocument(chunks: KnowledgeChunk[]): void {
    for (const chunk of chunks) {
      if (this.chunks.has(chunk.id)) continue;

      const tokens = removeStopwords(tokenize(chunk.content));
      this.chunks.set(chunk.id, chunk);
      this.docLengths.set(chunk.id, tokens.length);
      this.totalDocLength += tokens.length;

      // Track document -> chunk mapping
      let chunkSet = this.docToChunks.get(chunk.documentId);
      if (!chunkSet) {
        chunkSet = new Set();
        this.docToChunks.set(chunk.documentId, chunkSet);
      }
      chunkSet.add(chunk.id);

      // Build inverted index
      const freqs = new Map<string, number>();
      for (const token of tokens) {
        freqs.set(token, (freqs.get(token) ?? 0) + 1);
      }
      for (const [term, freq] of freqs) {
        let postings = this.invertedIndex.get(term);
        if (!postings) {
          postings = new Map();
          this.invertedIndex.set(term, postings);
        }
        postings.set(chunk.id, freq);
      }
    }
  }

  /** Remove all chunks belonging to a document. */
  removeDocument(documentId: string): void {
    const chunkIds = this.docToChunks.get(documentId);
    if (!chunkIds) return;

    for (const chunkId of chunkIds) {
      const docLen = this.docLengths.get(chunkId) ?? 0;
      this.totalDocLength -= docLen;
      this.docLengths.delete(chunkId);
      this.chunks.delete(chunkId);

      // Remove from inverted index
      for (const [, postings] of this.invertedIndex) {
        postings.delete(chunkId);
      }
    }
    this.docToChunks.delete(documentId);
  }

  /** Search the index. Returns chunks sorted by relevance (descending). */
  search(query: string, topK = 10): ScoredChunk[] {
    const queryTerms = removeStopwords(tokenize(query));
    if (queryTerms.length === 0 || this.size === 0) return [];

    const N = this.size;
    const avgdl = this.totalDocLength / N;
    const scores = new Map<string, number>();

    for (const term of queryTerms) {
      const postings = this.invertedIndex.get(term);
      if (!postings) continue;

      const n = postings.size;
      const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1);

      for (const [chunkId, freq] of postings) {
        const dl = this.docLengths.get(chunkId) ?? 0;
        const tf = (freq * (this.k1 + 1)) / (freq + this.k1 * (1 - this.b + this.b * (dl / avgdl)));
        const prev = scores.get(chunkId) ?? 0;
        scores.set(chunkId, prev + idf * tf);
      }
    }

    const results: ScoredChunk[] = [];
    for (const [chunkId, score] of scores) {
      const chunk = this.chunks.get(chunkId)!;
      results.push({ chunk, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /** Number of chunks in the index. */
  get size(): number {
    return this.chunks.size;
  }

  /** Clear the entire index. */
  clear(): void {
    this.invertedIndex.clear();
    this.docLengths.clear();
    this.chunks.clear();
    this.docToChunks.clear();
    this.totalDocLength = 0;
  }
}
