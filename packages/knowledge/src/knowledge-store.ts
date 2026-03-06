import type {
  KnowledgeDocument,
  KnowledgeStoreOptions,
  KnowledgeSearchOptions,
  SearchResult,
} from '@guidekit/core';
import { KnowledgeError, ErrorCodes } from '@guidekit/core';
import { chunkDocument } from './chunker.js';
import { BM25Index } from './bm25.js';
import { TFIDFIndex } from './tfidf.js';
import { buildAttribution } from './attribution.js';

/**
 * In-memory knowledge store that composes document chunking with
 * BM25 and TF-IDF search indexes.
 */
export class KnowledgeStore {
  private readonly options: Required<
    Pick<KnowledgeStoreOptions, 'engine' | 'maxDocuments' | 'maxTotalChunks' | 'topK'>
  > & Pick<KnowledgeStoreOptions, 'chunker'>;

  private readonly documents = new Map<string, KnowledgeDocument>();
  private readonly bm25 = new BM25Index();
  private readonly tfidf = new TFIDFIndex();
  private totalChunks = 0;

  constructor(options?: KnowledgeStoreOptions) {
    this.options = {
      engine: options?.engine ?? 'bm25',
      maxDocuments: options?.maxDocuments ?? 100,
      maxTotalChunks: options?.maxTotalChunks ?? 5000,
      topK: options?.topK ?? 5,
      chunker: options?.chunker,
    };

    if (options?.persistConsent) {
      console.warn(
        '[GuideKit] KnowledgeStore persistence via IndexedDB is not yet implemented. Data is in-memory only.',
      );
    }
  }

  /** Add a document. Chunks it and indexes all chunks. */
  addDocument(doc: KnowledgeDocument): void {
    if (this.documents.size >= this.options.maxDocuments) {
      throw new KnowledgeError({
        code: ErrorCodes.KNOWLEDGE_STORE_QUOTA,
        message: `Maximum document limit (${this.options.maxDocuments}) reached`,
        suggestion: 'Remove unused documents before adding new ones.',
      });
    }

    const chunks = chunkDocument(doc, this.options.chunker);

    if (this.totalChunks + chunks.length > this.options.maxTotalChunks) {
      throw new KnowledgeError({
        code: ErrorCodes.KNOWLEDGE_STORE_QUOTA,
        message: `Adding ${chunks.length} chunks would exceed the total chunk limit (${this.options.maxTotalChunks})`,
        suggestion: 'Remove documents or increase maxTotalChunks.',
      });
    }

    const storedDoc: KnowledgeDocument = { ...doc, chunks };
    this.documents.set(doc.id, storedDoc);
    this.bm25.addDocument(chunks);
    this.tfidf.addDocument(chunks);
    this.totalChunks += chunks.length;
  }

  /** Remove a document and its chunks from the index. */
  removeDocument(id: string): void {
    const doc = this.documents.get(id);
    if (!doc) return;

    const chunkCount = doc.chunks?.length ?? 0;
    this.bm25.removeDocument(id);
    this.tfidf.removeDocument(id);
    this.documents.delete(id);
    this.totalChunks -= chunkCount;
  }

  /** Update a document (remove + re-add). */
  updateDocument(id: string, doc: KnowledgeDocument): void {
    this.removeDocument(id);
    this.addDocument(doc);
  }

  /** Search the knowledge base. */
  search(query: string, options?: KnowledgeSearchOptions): SearchResult[] {
    const engine = options?.engine ?? this.options.engine;
    const topK = options?.topK ?? this.options.topK;
    const index = engine === 'tfidf' ? this.tfidf : this.bm25;

    // Fetch more results than needed so we can filter
    let scored = index.search(query, this.totalChunks || 1);

    // Filter by documentIds
    if (options?.documentIds && options.documentIds.length > 0) {
      const allowed = new Set(options.documentIds);
      scored = scored.filter((s) => allowed.has(s.chunk.documentId));
    }

    // Filter by minScore
    if (options?.minScore !== undefined) {
      scored = scored.filter((s) => s.score >= options.minScore!);
    }

    // Take topK
    scored = scored.slice(0, topK);

    // Map to SearchResult with attribution
    return scored.map((s) => {
      const doc = this.documents.get(s.chunk.documentId);
      const title = doc?.title ?? s.chunk.documentId;
      return {
        chunk: s.chunk,
        score: s.score,
        source: buildAttribution(s.chunk, s.score, title),
      };
    });
  }

  /** Get a document by ID. */
  getDocument(id: string): KnowledgeDocument | undefined {
    return this.documents.get(id);
  }

  /** Get all document IDs. */
  getDocumentIds(): string[] {
    return [...this.documents.keys()];
  }

  /** Clear all documents and indexes. */
  clear(): void {
    this.documents.clear();
    this.bm25.clear();
    this.tfidf.clear();
    this.totalChunks = 0;
  }

  /** Get store statistics. */
  getStats(): { documentCount: number; chunkCount: number } {
    return {
      documentCount: this.documents.size,
      chunkCount: this.totalChunks,
    };
  }
}
