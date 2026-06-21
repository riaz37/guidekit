import { describe, it, expect, vi, afterEach } from 'vitest';
import { SiteKnowledgeClient, formatSiteSearchResults } from './site-knowledge.js';

describe('SiteKnowledgeClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sends authenticated site-search requests', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: 'pricing',
              title: 'Pricing',
              url: '/pricing',
              excerpt: 'Pro plan details',
              score: 2,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const client = new SiteKnowledgeClient({
      config: { endpoint: '/api/guidekit/site-search', topK: 4 },
      getToken: () => 'session-token',
    });

    const result = await client.search('pro plan');

    expect(result.results).toHaveLength(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/guidekit/site-search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
        body: JSON.stringify({ query: 'pro plan', topK: 4 }),
      }),
    );
  });

  it('throws a readable error for auth failures', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Permission "site:read" not granted' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as typeof fetch;

    const client = new SiteKnowledgeClient({
      config: { endpoint: '/api/guidekit/site-search' },
      getToken: () => 'session-token',
    });

    await expect(client.search('security')).rejects.toThrow('site:read');
  });

  it('rejects malformed responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ nope: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as typeof fetch;

    const client = new SiteKnowledgeClient({
      config: { endpoint: '/api/guidekit/site-search' },
      getToken: () => 'session-token',
    });

    await expect(client.search('security')).rejects.toThrow('results array');
  });

  it('formats site search results for prompt retrieval', () => {
    const section = formatSiteSearchResults([
      {
        id: 'security',
        title: 'Security',
        url: '/security',
        sectionId: 'api-keys',
        excerpt: 'API keys stay server-side.',
        score: 3,
      },
    ]);

    expect(section).toContain('Relevant Website Content');
    expect(section).toContain('Security (/security#api-keys)');
    expect(section).toContain('API keys stay server-side');
  });
});
