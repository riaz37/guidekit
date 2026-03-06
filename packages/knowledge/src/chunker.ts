import type { KnowledgeChunk, KnowledgeDocument, ChunkerOptions } from '@guidekit/core';

const HEADING_RE = /^#{1,6}\s+/;

function isHeadingLine(line: string): boolean {
  return HEADING_RE.test(line);
}

function extractHeading(line: string): string {
  return line.replace(HEADING_RE, '').trim();
}

function normalize(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function makeChunk(
  doc: KnowledgeDocument,
  content: string,
  index: number,
  startOffset: number,
  headingContext: string | undefined,
): KnowledgeChunk | null {
  const trimmed = normalize(content);
  if (trimmed.length === 0) return null;
  return {
    id: `${doc.id}:${index}`,
    documentId: doc.id,
    content: trimmed,
    index,
    startOffset,
    endOffset: startOffset + content.length,
    ...(headingContext !== undefined ? { headingContext } : {}),
  };
}

function chunkByHeading(doc: KnowledgeDocument): KnowledgeChunk[] {
  const lines = doc.content.split('\n');
  const chunks: KnowledgeChunk[] = [];
  let current = '';
  let currentStart = 0;
  let currentHeading: string | undefined;
  let offset = 0;
  let idx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineWithNewline = i < lines.length - 1 ? line + '\n' : line;

    if (isHeadingLine(line)) {
      if (current.length > 0) {
        const chunk = makeChunk(doc, current, idx, currentStart, currentHeading);
        if (chunk) { chunks.push(chunk); idx++; }
      }
      currentHeading = extractHeading(line);
      currentStart = offset;
      current = lineWithNewline;
    } else {
      current += lineWithNewline;
    }
    offset += lineWithNewline.length;
  }

  if (current.length > 0) {
    const chunk = makeChunk(doc, current, idx, currentStart, currentHeading);
    if (chunk) chunks.push(chunk);
  }

  return chunks;
}

function chunkByParagraph(doc: KnowledgeDocument): KnowledgeChunk[] {
  const parts = doc.content.split('\n\n');
  const chunks: KnowledgeChunk[] = [];
  let offset = 0;
  let idx = 0;
  let lastHeading: string | undefined;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const startOffset = offset;
    offset += part.length + (i < parts.length - 1 ? 2 : 0);

    const lines = part.split('\n');
    for (const line of lines) {
      if (isHeadingLine(line)) {
        lastHeading = extractHeading(line);
      }
    }

    const chunk = makeChunk(doc, part, idx, startOffset, lastHeading);
    if (chunk) { chunks.push(chunk); idx++; }
  }

  return chunks;
}

function chunkByFixed(doc: KnowledgeDocument, chunkSize: number, overlap: number): KnowledgeChunk[] {
  const content = doc.content;
  const chunks: KnowledgeChunk[] = [];
  let pos = 0;
  let idx = 0;

  while (pos < content.length) {
    const end = Math.min(pos + chunkSize, content.length);
    const slice = content.slice(pos, end);

    let headingContext: string | undefined;
    const lines = slice.split('\n');
    for (const line of lines) {
      if (isHeadingLine(line)) {
        headingContext = extractHeading(line);
      }
    }

    const chunk = makeChunk(doc, slice, idx, pos, headingContext);
    if (chunk) { chunks.push(chunk); idx++; }

    const step = chunkSize - overlap;
    pos += step > 0 ? step : chunkSize;
  }

  return chunks;
}

export function chunkDocument(doc: KnowledgeDocument, options?: ChunkerOptions): KnowledgeChunk[] {
  const strategy = options?.strategy ?? 'heading';

  switch (strategy) {
    case 'heading':
      return chunkByHeading(doc);
    case 'paragraph':
      return chunkByParagraph(doc);
    case 'fixed':
      return chunkByFixed(doc, options?.chunkSize ?? 512, options?.overlap ?? 64);
    default:
      return chunkByHeading(doc);
  }
}
