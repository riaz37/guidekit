/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { createSessionToken } from '../auth.js';
import { InMemorySessionStore } from '../session-store.js';
import { handleSiteSearch } from './site-search.js';

const TEST_SECRET = 'test-secret-that-is-long-enough-for-hmac-256-bits!!';

async function authedSiteSearchRequest(
  body: Record<string, unknown>,
  options?: { permissions?: string[]; origin?: string; allowedOrigins?: string[] },
): Promise<{ request: Request; store: InMemorySessionStore }> {
  const store = new InMemorySessionStore();
  const { token } = await createSessionToken({
    signingSecret: TEST_SECRET,
    sessionId: 'site-search-session',
    llmApiKey: 'test-llm-key',
    permissions: options?.permissions,
    allowedOrigins: options?.allowedOrigins,
    sessionStore: store,
  });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (options?.origin) headers.Origin = options.origin;

  return {
    store,
    request: new Request('http://localhost/api/guidekit/site-search', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  };
}

describe('handleSiteSearch', () => {
  const documents = [
    {
      id: 'pricing',
      title: 'Pricing',
      content: 'The Pro plan includes autonomous website guidance and priority support.',
      metadata: { url: '/pricing' },
    },
    {
      id: 'security',
      title: 'Security',
      content: 'GuideKit keeps provider API keys on the server and uses short lived JWTs.',
      metadata: { url: '/security', sectionId: 'api-keys' },
    },
  ];

  it('returns attributed results from configured site documents', async () => {
    const { request, store } = await authedSiteSearchRequest({ query: 'API keys', topK: 2 });

    const res = await handleSiteSearch(request, {
      signingSecret: TEST_SECRET,
      sessionStore: store,
      documents,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      id: 'security',
      title: 'Security',
      url: '/security',
      sectionId: 'api-keys',
    });
    expect(body.results[0].excerpt).toContain('provider API keys');
    expect(typeof body.results[0].score).toBe('number');
  });

  it('rejects requests without the site:read permission when permissions are explicit', async () => {
    const { request, store } = await authedSiteSearchRequest(
      { query: 'pricing' },
      { permissions: ['llm'] },
    );

    const res = await handleSiteSearch(request, {
      signingSecret: TEST_SECRET,
      sessionStore: store,
      documents,
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('site:read');
  });

  it('enforces allowed origins from the session token', async () => {
    const { request, store } = await authedSiteSearchRequest(
      { query: 'pricing' },
      {
        allowedOrigins: ['https://app.example.com'],
        origin: 'https://evil.example.com',
      },
    );

    const res = await handleSiteSearch(request, {
      signingSecret: TEST_SECRET,
      sessionStore: store,
      documents,
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Origin');
  });

  it('validates request body shape', async () => {
    const { request, store } = await authedSiteSearchRequest({ query: '' });

    const res = await handleSiteSearch(request, {
      signingSecret: TEST_SECRET,
      sessionStore: store,
      documents,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('query');
  });

  it('returns an empty result list when no document matches', async () => {
    const { request, store } = await authedSiteSearchRequest({ query: 'enterprise bananas' });

    const res = await handleSiteSearch(request, {
      signingSecret: TEST_SECRET,
      sessionStore: store,
      documents,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([]);
  });
});
