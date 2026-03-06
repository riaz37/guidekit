import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeStore } from './knowledge-store.js';
import { ErrorCodes } from '@guidekit/core';
import type { KnowledgeDocument } from '@guidekit/core';

function createDoc(id: string, content: string, title = 'Test Doc'): KnowledgeDocument {
  return { id, title, content };
}

describe('KnowledgeStore', () => {
  let store: KnowledgeStore;

  beforeEach(() => {
    store = new KnowledgeStore();
  });

  it('addDocument + search lifecycle', () => {
    store.addDocument(createDoc('d1', '# Guide\nLearn javascript programming basics'));
    const results = store.search('javascript');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.chunk.documentId).toBe('d1');
    expect(results[0]!.score).toBeGreaterThan(0);
    expect(results[0]!.source).toBeDefined();
  });

  it('removeDocument removes from search results', () => {
    store.addDocument(createDoc('d1', 'unique xylophone content'));
    store.removeDocument('d1');
    const results = store.search('xylophone');
    expect(results).toEqual([]);
  });

  it('updateDocument replaces content', () => {
    store.addDocument(createDoc('d1', 'old content about xylophone'));
    store.updateDocument('d1', createDoc('d1', 'new content about saxophone'));
    const oldResults = store.search('xylophone');
    const newResults = store.search('saxophone');
    expect(oldResults).toEqual([]);
    expect(newResults.length).toBeGreaterThan(0);
  });

  it('maxDocuments limit throws KNOWLEDGE_STORE_QUOTA', () => {
    const smallStore = new KnowledgeStore({ maxDocuments: 1 });
    smallStore.addDocument(createDoc('d1', 'first doc'));
    expect(() => smallStore.addDocument(createDoc('d2', 'second doc'))).toThrowError(
      /Maximum document limit/,
    );
    try {
      smallStore.addDocument(createDoc('d2', 'second doc'));
    } catch (e: any) {
      expect(e.code).toBe(ErrorCodes.KNOWLEDGE_STORE_QUOTA);
    }
  });

  it('maxTotalChunks limit throws KNOWLEDGE_STORE_QUOTA', () => {
    const smallStore = new KnowledgeStore({ maxTotalChunks: 1 });
    // A doc with headings will produce multiple chunks
    const doc = createDoc('d1', '# A\nFirst\n# B\nSecond\n# C\nThird');
    expect(() => smallStore.addDocument(doc)).toThrowError(/chunk limit/);
    try {
      smallStore.addDocument(doc);
    } catch (e: any) {
      expect(e.code).toBe(ErrorCodes.KNOWLEDGE_STORE_QUOTA);
    }
  });

  it('getDocument returns stored doc', () => {
    const doc = createDoc('d1', 'hello world');
    store.addDocument(doc);
    const stored = store.getDocument('d1');
    expect(stored).toBeDefined();
    expect(stored!.id).toBe('d1');
    expect(stored!.title).toBe('Test Doc');
  });

  it('getDocument returns undefined for missing doc', () => {
    expect(store.getDocument('nonexistent')).toBeUndefined();
  });

  it('getDocumentIds returns all IDs', () => {
    store.addDocument(createDoc('d1', 'first'));
    store.addDocument(createDoc('d2', 'second'));
    const ids = store.getDocumentIds();
    expect(ids).toContain('d1');
    expect(ids).toContain('d2');
    expect(ids.length).toBe(2);
  });

  it('clear empties everything', () => {
    store.addDocument(createDoc('d1', 'content'));
    store.clear();
    expect(store.getDocumentIds()).toEqual([]);
    expect(store.getStats().documentCount).toBe(0);
    expect(store.getStats().chunkCount).toBe(0);
  });

  it('search with documentIds filter', () => {
    store.addDocument(createDoc('d1', 'javascript programming tutorial'));
    store.addDocument(createDoc('d2', 'javascript advanced patterns'));
    const results = store.search('javascript', { documentIds: ['d1'] });
    expect(results.every((r) => r.chunk.documentId === 'd1')).toBe(true);
  });

  it('search with minScore filter', () => {
    store.addDocument(createDoc('d1', 'javascript programming'));
    const results = store.search('javascript', { minScore: 9999 });
    expect(results).toEqual([]);
  });

  it('search with engine override (tfidf vs bm25)', () => {
    store.addDocument(createDoc('d1', 'javascript programming language'));
    const bm25Results = store.search('javascript', { engine: 'bm25' });
    const tfidfResults = store.search('javascript', { engine: 'tfidf' });
    expect(bm25Results.length).toBeGreaterThan(0);
    expect(tfidfResults.length).toBeGreaterThan(0);
  });

  it('getStats returns correct counts', () => {
    store.addDocument(createDoc('d1', '# A\nFirst\n# B\nSecond'));
    const stats = store.getStats();
    expect(stats.documentCount).toBe(1);
    expect(stats.chunkCount).toBeGreaterThan(0);
  });
});
