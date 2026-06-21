/**
 * @module @guidekit/server/proxy/site-search
 *
 * Token-protected website knowledge search for GuideKit Agent Runtime.
 */

import { validateSessionToken } from '../auth.js';
import type { SessionStore } from '../session-store.js';

export interface SiteKnowledgeDocument {
  id: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface SiteSearchRequestBody {
  query: string;
  topK?: number;
}

export interface SiteSearchResult {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  score: number;
  sectionId?: string;
  metadata?: Record<string, unknown>;
}

export interface SiteSearchOptions {
  signingSecret: string | string[];
  sessionStore: SessionStore;
  documents?: SiteKnowledgeDocument[];
  search?: (query: string, options: { topK: number }) => SiteSearchResult[] | Promise<SiteSearchResult[]>;
  topK?: number;
}

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' },
  });
}

function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice(7).trim() || null;
}

function requestOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin');
  return origin && origin.trim().length > 0 ? origin : null;
}

function enforceAllowedOrigins(
  allowedOrigins: string[] | undefined,
  origin: string | null,
): Response | null {
  if (!allowedOrigins || allowedOrigins.length === 0) return null;
  if (!origin) return jsonResponse({ error: 'Missing Origin header' }, 403);
  if (!allowedOrigins.includes(origin)) return jsonResponse({ error: 'Origin not allowed' }, 403);
  return null;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 2);
}

function excerptFor(content: string, terms: string[]): string {
  const lower = content.toLowerCase();
  const firstHit = terms
    .map((term) => lower.indexOf(term))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstHit - 80);
  const excerpt = content.slice(start, start + 240).trim();
  return `${start > 0 ? '…' : ''}${excerpt}${start + 240 < content.length ? '…' : ''}`;
}

function searchDocuments(
  documents: SiteKnowledgeDocument[],
  query: string,
  topK: number,
): SiteSearchResult[] {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return [];

  return documents
    .map((doc) => {
      const haystack = `${doc.title}\n${doc.content}`.toLowerCase();
      const score = terms.reduce((sum, term) => {
        const titleBoost = doc.title.toLowerCase().includes(term) ? 2 : 0;
        const bodyHit = haystack.includes(term) ? 1 : 0;
        return sum + titleBoost + bodyHit;
      }, 0);
      return { doc, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ doc, score }) => ({
      id: doc.id,
      title: doc.title,
      url: typeof doc.metadata?.url === 'string' ? doc.metadata.url : '',
      sectionId: typeof doc.metadata?.sectionId === 'string' ? doc.metadata.sectionId : undefined,
      excerpt: excerptFor(doc.content, terms),
      score,
      metadata: doc.metadata,
    }));
}

export async function handleSiteSearch(
  request: Request,
  options: SiteSearchOptions,
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const token = extractBearerToken(request);
  if (!token) return jsonResponse({ error: 'Missing Authorization Bearer token' }, 401);

  const validation = await validateSessionToken(token, options.signingSecret);
  if (!validation.valid || !validation.payload) {
    return jsonResponse({ error: validation.error ?? 'Invalid token' }, 401);
  }

  const originCheck = enforceAllowedOrigins(validation.payload.audience, requestOrigin(request));
  if (originCheck) return originCheck;

  if (!validation.payload.permissions.includes('site:read')) {
    return jsonResponse({ error: 'Permission "site:read" not granted' }, 403);
  }

  let body: SiteSearchRequestBody;
  try {
    body = (await request.json()) as SiteSearchRequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (typeof body.query !== 'string' || body.query.trim().length === 0) {
    return jsonResponse({ error: 'Invalid body: query must be a non-empty string' }, 400);
  }
  if (body.topK !== undefined && (!Number.isFinite(body.topK) || body.topK <= 0)) {
    return jsonResponse({ error: 'Invalid body: topK must be a positive number' }, 400);
  }

  const topK = Math.min(Math.floor(body.topK ?? options.topK ?? 5), 20);
  const results = options.search
    ? await options.search(body.query, { topK })
    : searchDocuments(options.documents ?? [], body.query, topK);

  return jsonResponse({ results }, 200);
}
