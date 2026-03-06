import { describe, it, expect } from 'vitest';
import { buildAttribution, formatAttributions } from './attribution.js';
import type { KnowledgeChunk, SearchResult, SourceAttribution } from '@guidekit/core';

function makeChunk(content: string, id = 'c1', docId = 'd1'): KnowledgeChunk {
  return { id, documentId: docId, content, index: 0, startOffset: 0, endOffset: content.length };
}

function makeResult(score: number, title: string, content = 'Some content'): SearchResult {
  const chunk = makeChunk(content, `c-${score}`, `d-${score}`);
  const source: SourceAttribution = {
    documentId: chunk.documentId,
    chunkId: chunk.id,
    title,
    relevanceScore: score,
    excerpt: content.length > 200 ? content.slice(0, 200) + '...' : content,
  };
  return { chunk, score, source };
}

describe('buildAttribution', () => {
  it('creates correct shape', () => {
    const chunk = makeChunk('Hello world');
    const attr = buildAttribution(chunk, 0.85, 'My Title');
    expect(attr.documentId).toBe('d1');
    expect(attr.chunkId).toBe('c1');
    expect(attr.title).toBe('My Title');
    expect(attr.relevanceScore).toBe(0.85);
    expect(attr.excerpt).toBe('Hello world');
  });

  it('excerpt truncated to 200 chars with ...', () => {
    const longContent = 'x'.repeat(300);
    const chunk = makeChunk(longContent);
    const attr = buildAttribution(chunk, 1.0, 'Title');
    expect(attr.excerpt.length).toBe(203); // 200 + '...'
    expect(attr.excerpt.endsWith('...')).toBe(true);
  });

  it('short content not truncated', () => {
    const chunk = makeChunk('Short content');
    const attr = buildAttribution(chunk, 0.5, 'Title');
    expect(attr.excerpt).toBe('Short content');
  });
});

describe('formatAttributions', () => {
  it('formats markdown citations', () => {
    const results = [makeResult(0.9, 'Doc A')];
    const formatted = formatAttributions(results);
    expect(formatted).toContain('**Sources:**');
    expect(formatted).toContain('[1]');
    expect(formatted).toContain('*Doc A*');
    expect(formatted).toContain('relevance: 0.90');
  });

  it('sorts by relevance', () => {
    const results = [
      makeResult(0.3, 'Low'),
      makeResult(0.9, 'High'),
      makeResult(0.6, 'Mid'),
    ];
    const formatted = formatAttributions(results);
    const highIdx = formatted.indexOf('*High*');
    const midIdx = formatted.indexOf('*Mid*');
    const lowIdx = formatted.indexOf('*Low*');
    expect(highIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(lowIdx);
  });

  it('caps at 10', () => {
    const results = Array.from({ length: 15 }, (_, i) =>
      makeResult(i + 1, `Doc ${i}`),
    );
    const formatted = formatAttributions(results);
    expect(formatted).toContain('[10]');
    expect(formatted).not.toContain('[11]');
  });

  it('returns empty string for empty array', () => {
    expect(formatAttributions([])).toBe('');
  });
});
