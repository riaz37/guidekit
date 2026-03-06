import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeStore } from './knowledge-store.js';
import { createKnowledgeContextProvider } from './context-provider.js';
import type { KnowledgeDocument } from '@guidekit/core';

function createDoc(id: string, content: string, title = 'Test Doc'): KnowledgeDocument {
  return { id, title, content };
}

describe('createKnowledgeContextProvider', () => {
  let store: KnowledgeStore;

  beforeEach(() => {
    store = new KnowledgeStore();
  });

  it('returns formatted knowledge section with header', () => {
    store.addDocument(createDoc('d1', 'javascript programming language tutorial'));
    const provider = createKnowledgeContextProvider(store);
    const result = provider('javascript');
    expect(result).toContain('## Relevant Knowledge');
    expect(result).toContain('javascript');
    expect(result).toContain('**Sources:**');
  });

  it('returns empty string for no results', () => {
    const provider = createKnowledgeContextProvider(store);
    const result = provider('nonexistent xyz');
    expect(result).toBe('');
  });

  it('respects token budget (truncates)', () => {
    // Add multiple large documents
    for (let i = 0; i < 10; i++) {
      const content = `# Section ${i}\n${'keyword '.repeat(200)}`;
      store.addDocument(createDoc(`d${i}`, content));
    }
    // Very small budget: 50 tokens ~200 chars
    const provider = createKnowledgeContextProvider(store, { tokenBudget: 50 });
    const result = provider('keyword');
    // The result should be limited; with budget of 50 tokens (200 chars),
    // it can't fit all 10 large chunks
    if (result.length > 0) {
      expect(result.length).toBeLessThan(5000);
    }
  });

  it('custom header option', () => {
    store.addDocument(createDoc('d1', 'custom header content'));
    const provider = createKnowledgeContextProvider(store, { header: 'My Custom Header' });
    const result = provider('custom header');
    expect(result).toContain('## My Custom Header');
  });

  it('includes attribution footer', () => {
    store.addDocument(createDoc('d1', 'attribution footer test content'));
    const provider = createKnowledgeContextProvider(store);
    const result = provider('attribution footer');
    expect(result).toContain('**Sources:**');
    expect(result).toContain('relevance:');
  });
});
