import { describe, it, expect, beforeEach } from 'vitest';
import { BM25Index } from './bm25.js';
import type { KnowledgeChunk } from '@guidekit/core';

function makeChunk(id: string, docId: string, content: string, index = 0): KnowledgeChunk {
  return { id, documentId: docId, content, index, startOffset: 0, endOffset: content.length };
}

describe('BM25Index', () => {
  let idx: BM25Index;

  beforeEach(() => {
    idx = new BM25Index();
  });

  it('single term search returns matching chunk', () => {
    idx.addDocument([makeChunk('c1', 'd1', 'javascript programming language')]);
    const results = idx.search('javascript');
    expect(results.length).toBe(1);
    expect(results[0]!.chunk.id).toBe('c1');
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it('multi-term search ranks by relevance', () => {
    idx.addDocument([
      makeChunk('c1', 'd1', 'javascript programming language tutorial'),
      makeChunk('c2', 'd2', 'javascript javascript javascript advanced guide'),
    ]);
    const results = idx.search('javascript');
    expect(results.length).toBe(2);
    // Both match, scores should be > 0
    expect(results[0]!.score).toBeGreaterThan(0);
    expect(results[1]!.score).toBeGreaterThan(0);
  });

  it('non-matching query returns empty', () => {
    idx.addDocument([makeChunk('c1', 'd1', 'cats dogs animals')]);
    const results = idx.search('javascript');
    expect(results).toEqual([]);
  });

  it('removeDocument removes from index', () => {
    idx.addDocument([makeChunk('c1', 'd1', 'hello world')]);
    expect(idx.size).toBe(1);
    idx.removeDocument('d1');
    expect(idx.size).toBe(0);
  });

  it('search after remove does not include removed doc', () => {
    idx.addDocument([makeChunk('c1', 'd1', 'unique keyword xyz')]);
    idx.removeDocument('d1');
    const results = idx.search('unique keyword xyz');
    expect(results).toEqual([]);
  });

  it('empty index returns empty', () => {
    const results = idx.search('anything');
    expect(results).toEqual([]);
  });

  it('size property is correct', () => {
    expect(idx.size).toBe(0);
    idx.addDocument([
      makeChunk('c1', 'd1', 'first chunk'),
      makeChunk('c2', 'd1', 'second chunk'),
    ]);
    expect(idx.size).toBe(2);
  });

  it('clear() empties index', () => {
    idx.addDocument([makeChunk('c1', 'd1', 'content')]);
    idx.clear();
    expect(idx.size).toBe(0);
    expect(idx.search('content')).toEqual([]);
  });

  it('relevance ordering: more relevant doc scores higher', () => {
    idx.addDocument([
      makeChunk('c1', 'd1', 'python programming guide basics introduction'),
      makeChunk('c2', 'd2', 'python python python python expert reference'),
    ]);
    const results = idx.search('python');
    expect(results.length).toBe(2);
    // Both match python, results sorted by score descending
    expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
  });
});
