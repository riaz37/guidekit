import type { SiteKnowledgeConfig, SiteSearchResponse, SiteSearchResult } from '../types/index.js';
import type { EventBus } from '../bus/index.js';
import type { PipelineStageHooks } from '../pipeline/index.js';

export interface SiteKnowledgeClientOptions {
  config?: SiteKnowledgeConfig;
  getToken: () => string | null;
}

export class SiteKnowledgeClient {
  private readonly config?: SiteKnowledgeConfig;
  private readonly getToken: () => string | null;

  constructor(options: SiteKnowledgeClientOptions) {
    this.config = options.config;
    this.getToken = options.getToken;
  }

  get isConfigured(): boolean {
    return typeof this.config?.endpoint === 'string' && this.config.endpoint.length > 0;
  }

  async search(query: string, options?: { topK?: number }): Promise<SiteSearchResponse> {
    if (!this.isConfigured || !this.config) {
      return { results: [] };
    }

    const token = this.getToken();
    if (!token) {
      throw new Error('No GuideKit session token available for site search.');
    }

    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        topK: options?.topK ?? this.config.topK,
      }),
    });

    if (!response.ok) {
      let message = `Site search failed with status ${response.status}`;
      try {
        const body = (await response.json()) as { error?: unknown };
        if (typeof body.error === 'string') message = body.error;
      } catch {
        // Keep status-based message when response body is not JSON.
      }
      throw new Error(message);
    }

    const body = (await response.json()) as Partial<SiteSearchResponse>;
    if (!Array.isArray(body.results)) {
      throw new Error('Site search response must include a results array.');
    }

    return {
      results: body.results.filter(isSiteSearchResult),
    };
  }
}

function isSiteSearchResult(value: unknown): value is SiteSearchResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.id === 'string' &&
    typeof result.title === 'string' &&
    typeof result.url === 'string' &&
    typeof result.excerpt === 'string' &&
    typeof result.score === 'number'
  );
}

export function formatSiteSearchResults(results: SiteSearchResult[]): string {
  if (results.length === 0) return '';
  const lines = ['## Relevant Website Content'];
  for (const result of results) {
    const location = result.sectionId ? `${result.url}#${result.sectionId}` : result.url;
    lines.push(`- ${result.title} (${location}): ${result.excerpt}`);
  }
  return lines.join('\n');
}

export function composeSiteKnowledgePipelineHooks(options: {
  client: SiteKnowledgeClient;
  bus: EventBus;
  baseHooks?: PipelineStageHooks;
}): PipelineStageHooks | undefined {
  if (!options.client.isConfigured) return options.baseHooks;

  const siteRetrieve: PipelineStageHooks['retrieve'] = async (ctx) => {
    try {
      const response = await options.client.search(ctx.userMessage);
      const section = formatSiteSearchResults(response.results);
      if (!section) return ctx;
      return {
        ...ctx,
        knowledgeSection: ctx.knowledgeSection
          ? `${ctx.knowledgeSection}\n\n${section}`
          : section,
        metadata: {
          ...ctx.metadata,
          sources: [
            ...((ctx.metadata.sources as string[] | undefined) ?? []),
            ...response.results.map((result) =>
              result.sectionId ? `${result.url}#${result.sectionId}` : result.url,
            ),
          ],
        },
      };
    } catch (err) {
      options.bus.emit('site-search:error', {
        message: err instanceof Error ? err.message : String(err),
      });
      return ctx;
    }
  };

  return {
    ...options.baseHooks,
    retrieve: options.baseHooks?.retrieve
      ? async (ctx) => siteRetrieve(await options.baseHooks!.retrieve!(ctx))
      : siteRetrieve,
  };
}
