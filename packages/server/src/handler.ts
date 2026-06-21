/**
 * @module @guidekit/server/handler
 */

import type { CreateSessionTokenOptions } from './auth.js';
import { createSessionToken, validateSessionToken } from './auth.js';
import { handleLLMProxy, type LLMProxyOptions } from './proxy/llm.js';
import { handleSiteSearch, type SiteSearchOptions } from './proxy/site-search.js';
import { handleVoiceProxy } from './proxy/voice.js';
import type { SessionStore } from './session-store.js';
import { defaultSessionStore } from './session-store.js';
import { createRateLimiter } from './middleware/rate-limit.js';

export interface GuideKitHandlerOptions {
  signingSecret: string | string[];
  sessionStore?: SessionStore;
  createTokenOptions?: (
    request: Request,
  ) => Omit<CreateSessionTokenOptions, 'signingSecret' | 'sessionStore'> | Promise<Omit<CreateSessionTokenOptions, 'signingSecret' | 'sessionStore'>>;
  llmProxy?: Omit<LLMProxyOptions, 'signingSecret' | 'sessionStore'>;
  siteKnowledge?: Omit<SiteSearchOptions, 'signingSecret' | 'sessionStore'>;
  rateLimit?: {
    windowMs?: number;
    maxRequests?: number;
  };
}

export type GuideKitRoute = 'token' | 'llm' | 'health' | 'stt' | 'tts' | 'site-search';

export function createGuideKitHandler(options: GuideKitHandlerOptions) {
  const store = options.sessionStore ?? defaultSessionStore;
  const rateLimiter = createRateLimiter(options.rateLimit);

  return async function guideKitHandler(
    request: Request,
    route: GuideKitRoute,
  ): Promise<Response> {
    const sessionId = await extractSessionId(request, options.signingSecret);
    const limited = rateLimiter(request, sessionId ?? undefined);
    if (limited) return limited;

    switch (route) {
      case 'token':
        return handleTokenRoute(request, options, store);
      case 'llm':
        return handleLLMProxy(request, {
          signingSecret: options.signingSecret,
          sessionStore: store,
          ...options.llmProxy,
        });
      case 'stt':
        return handleVoiceProxy(request, {
          signingSecret: options.signingSecret,
          sessionStore: store,
          kind: 'stt',
        });
      case 'tts':
        return handleVoiceProxy(request, {
          signingSecret: options.signingSecret,
          sessionStore: store,
          kind: 'tts',
        });
      case 'site-search':
        return handleSiteSearch(request, {
          signingSecret: options.signingSecret,
          sessionStore: store,
          ...options.siteKnowledge,
        });
      case 'health':
        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      default:
        return new Response(JSON.stringify({ error: 'Unknown route' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
    }
  };
}

async function extractSessionId(
  request: Request,
  signingSecret: string | string[],
): Promise<string | null> {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const result = await validateSessionToken(token, signingSecret);
  return result.valid && result.payload ? result.payload.sessionId : null;
}

async function handleTokenRoute(
  request: Request,
  options: GuideKitHandlerOptions,
  store: SessionStore,
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const tokenOpts = options.createTokenOptions
    ? await options.createTokenOptions(request)
    : {};

  if (!tokenOpts.llmApiKey && !tokenOpts.sttApiKey && !tokenOpts.ttsApiKey) {
    return new Response(
      JSON.stringify({
        error:
          'Server misconfigured: set LLM_API_KEY (and optional STT_API_KEY/TTS_API_KEY) in server environment.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const result = await createSessionToken({
    signingSecret: options.signingSecret,
    sessionStore: store,
    ...tokenOpts,
  });

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
