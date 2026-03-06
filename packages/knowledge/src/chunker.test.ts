import { describe, it, expect } from 'vitest';
import { chunkDocument } from './chunker.js';
import type { KnowledgeDocument } from '@guidekit/core';

function createDoc(id: string, content: string, title = 'Test Doc'): KnowledgeDocument {
  return { id, title, content };
}

describe('chunkDocument — heading strategy', () => {
  it('splits on markdown headings with headingContext set', () => {
    const doc = createDoc('d1', '# Intro\nHello world\n# Setup\nInstall stuff');
    const chunks = chunkDocument(doc, { strategy: 'heading' });
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.headingContext).toBe('Intro');
    expect(chunks[0]!.content).toContain('Hello world');
    expect(chunks[1]!.headingContext).toBe('Setup');
    expect(chunks[1]!.content).toContain('Install stuff');
  });

  it('content before first heading becomes first chunk', () => {
    const doc = createDoc('d2', 'Preamble text\n# First Heading\nBody');
    const chunks = chunkDocument(doc, { strategy: 'heading' });
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.headingContext).toBeUndefined();
    expect(chunks[0]!.content).toContain('Preamble text');
    expect(chunks[1]!.headingContext).toBe('First Heading');
  });

  it('chunk IDs follow doc.id:index pattern', () => {
    const doc = createDoc('myDoc', '# A\nfoo\n# B\nbar');
    const chunks = chunkDocument(doc, { strategy: 'heading' });
    expect(chunks[0]!.id).toBe('myDoc:0');
    expect(chunks[1]!.id).toBe('myDoc:1');
  });
});

describe('chunkDocument — paragraph strategy', () => {
  it('splits on double newlines', () => {
    const doc = createDoc('d3', 'First paragraph.\n\nSecond paragraph.');
    const chunks = chunkDocument(doc, { strategy: 'paragraph' });
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.content).toBe('First paragraph.');
    expect(chunks[1]!.content).toBe('Second paragraph.');
  });

  it('tracks headingContext from above', () => {
    const doc = createDoc('d4', '# Section\nIntro text\n\nMore text here');
    const chunks = chunkDocument(doc, { strategy: 'paragraph' });
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.headingContext).toBe('Section');
    expect(chunks[1]!.headingContext).toBe('Section');
  });
});

describe('chunkDocument — fixed strategy', () => {
  it('sliding window with correct size and overlap', () => {
    const content = 'a'.repeat(100);
    const doc = createDoc('d5', content);
    const chunks = chunkDocument(doc, { strategy: 'fixed', chunkSize: 40, overlap: 10 });
    // Steps: 0, 30, 60, 90 -> 4 chunks (step = 40-10 = 30)
    expect(chunks.length).toBe(4);
    expect(chunks[0]!.content.length).toBe(40);
    expect(chunks[0]!.startOffset).toBe(0);
    expect(chunks[1]!.startOffset).toBe(30);
  });

  it('detects headingContext within window', () => {
    const content = '# Title\nSome content here that goes on for a while to fill the chunk';
    const doc = createDoc('d6', content);
    const chunks = chunkDocument(doc, { strategy: 'fixed', chunkSize: 200, overlap: 0 });
    expect(chunks[0]!.headingContext).toBe('Title');
  });
});

describe('chunkDocument — general', () => {
  it('skips empty chunks', () => {
    const doc = createDoc('d7', '# A\n\n\n\n\n\n# B\nSome content');
    const chunks = chunkDocument(doc, { strategy: 'heading' });
    for (const chunk of chunks) {
      expect(chunk.content.trim().length).toBeGreaterThan(0);
    }
  });

  it('correct startOffset/endOffset', () => {
    const doc = createDoc('d8', '# First\nContent A\n# Second\nContent B');
    const chunks = chunkDocument(doc, { strategy: 'heading' });
    expect(chunks[0]!.startOffset).toBe(0);
    expect(chunks[0]!.endOffset).toBeGreaterThan(0);
    expect(chunks[1]!.startOffset).toBeGreaterThanOrEqual(chunks[0]!.endOffset);
  });

  it('empty document returns empty array', () => {
    const doc = createDoc('d9', '');
    const chunks = chunkDocument(doc, { strategy: 'heading' });
    expect(chunks).toEqual([]);
  });

  it('defaults to heading strategy', () => {
    const doc = createDoc('d10', '# Heading\nContent');
    const chunks = chunkDocument(doc);
    expect(chunks[0]!.headingContext).toBe('Heading');
  });
});
