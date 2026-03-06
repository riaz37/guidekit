import { describe, it, expect, beforeEach } from 'vitest';
import { TFIDFIndex } from './tfidf.js';
import type { KnowledgeChunk } from '@guidekit/core';

function makeChunk(id: string, docId: string, content: string, index = 0): KnowledgeChunk {
  return { id, documentId: docId, content, index, startOffset: 0, endOffset: content.length };
}

describe('TFIDFIndex', () => {
  let idx: TFIDFIndex;

  beforeEach(() => {
    idx = new TFIDFIndex();
  });

  it('single term search returns matching chunk', () => {
    // Need at least 2 docs so IDF is non-zero for the matching term
    idx.addDocument([
      makeChunk('c1', 'd1', 'javascript programming language'),
      makeChunk('c2', 'd2', 'python programming language'),
    ]);
    const results = idx.search('javascript');
    expect(results.length).toBe(1);
    expect(results[0]!.chunk.id).toBe('c1');
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it('multi-term search ranks by relevance', () => {
    idx.addDocument([
      makeChunk('c1', 'd1', 'javascript programming language tutorial'),
      makeChunk('c2', 'd2', 'javascript javascript javascript advanced guide'),
      makeChunk('c3', 'd3', 'python ruby golang unrelated'),
    ]);
    const results = idx.search('javascript');
    expect(results.length).toBe(2);
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
    // Results sorted by score descending
    expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
  });

  it('search returns results sorted by score descending', () => {
    idx.addDocument([
      makeChunk('c1', 'd1', 'react components hooks state management'),
      makeChunk('c2', 'd2', 'react react react framework library'),
      makeChunk('c3', 'd3', 'vue angular svelte frameworks'),
    ]);
    const results = idx.search('react');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });
});
