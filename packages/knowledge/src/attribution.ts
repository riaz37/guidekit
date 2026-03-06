import type { KnowledgeChunk, SourceAttribution, SearchResult } from '@guidekit/core';

/** Build a SourceAttribution from a chunk and relevance score. */
export function buildAttribution(
  chunk: KnowledgeChunk,
  score: number,
  title: string,
): SourceAttribution {
  const truncated = chunk.content.length > 200;
  const excerpt = truncated
    ? chunk.content.slice(0, 200) + '...'
    : chunk.content;

  return {
    documentId: chunk.documentId,
    chunkId: chunk.id,
    title,
    relevanceScore: score,
    excerpt,
  };
}

/** Format search results as markdown citation footnotes for LLM prompt injection. */
export function formatAttributions(results: SearchResult[]): string {
  if (results.length === 0) return '';

  const sorted = [...results]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const lines = sorted.map((r, i) => {
    const excerpt = r.source.excerpt.length > 100
      ? r.source.excerpt.slice(0, 100) + '...'
      : r.source.excerpt;
    return `[${i + 1}] *${r.source.title}* (relevance: ${r.score.toFixed(2)}) — "${excerpt}"`;
  });

  return `**Sources:**\n${lines.join('\n')}`;
}
