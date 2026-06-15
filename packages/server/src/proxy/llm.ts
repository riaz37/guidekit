/**
 * @module @guidekit/server/proxy/llm
 *
 * Server-side LLM streaming proxy. Validates session JWT and forwards
 * requests to the configured provider using server-stored API keys.
 */

import type { SessionStore } from '../session-store.js';
import { validateSessionToken } from '../auth.js';

export interface LLMProxyRequestBody {
  provider: 'gemini' | 'openai' | 'anthropic';
  model?: string;
  systemPrompt: string;
  contents: unknown;
  userMessage?: string;
  tools?: unknown;
  stream?: boolean;
}

export interface LLMProxyOptions {
  signingSecret: string | string[];
  sessionStore: SessionStore;
  defaultProvider?: 'gemini' | 'openai' | 'anthropic';
  defaultModel?: string;
}

function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice(7).trim() || null;
}

function geminiUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
}

/** Handle an LLM proxy request (POST, streaming SSE). */
export async function handleLLMProxy(
  request: Request,
  options: LLMProxyOptions,
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const token = extractBearerToken(request);
  if (!token) {
    return jsonResponse({ error: 'Missing Authorization Bearer token' }, 401);
  }

  const validation = await validateSessionToken(token, options.signingSecret);
  if (!validation.valid || !validation.payload) {
    return jsonResponse({ error: validation.error ?? 'Invalid token' }, 401);
  }

  const keys = await options.sessionStore.get(validation.payload.sessionId);
  if (!keys?.llmApiKey) {
    return jsonResponse(
      { error: 'Session expired or server restarted — request a new token' },
      401,
    );
  }

  let body: LLMProxyRequestBody;
  try {
    body = (await request.json()) as LLMProxyRequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const provider = body.provider ?? options.defaultProvider ?? 'gemini';
  const apiKey = keys.llmApiKey;

  try {
    if (provider === 'gemini') {
      return await proxyGemini(body, apiKey, options.defaultModel);
    }
    if (provider === 'openai') {
      return await proxyOpenAI(body, apiKey);
    }
    if (provider === 'anthropic') {
      return await proxyAnthropic(body, apiKey);
    }
    return jsonResponse({ error: `Unsupported provider: ${provider}` }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Proxy error';
    return jsonResponse({ error: message }, 502);
  }
}

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function proxyGemini(
  body: LLMProxyRequestBody,
  apiKey: string,
  defaultModel?: string,
): Promise<Response> {
  const model = body.model ?? defaultModel ?? 'gemini-2.5-flash';
  const contentsArray = body.contents as unknown[];
  const fullContents = body.userMessage
    ? [...contentsArray, { role: 'user', parts: [{ text: body.userMessage }] }]
    : contentsArray;

  const payload: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: body.systemPrompt }] },
    contents: fullContents,
    generationConfig: { temperature: 0.7, topP: 0.95, topK: 40 },
  };
  if (body.tools) payload.tools = body.tools;

  const upstream = await fetch(geminiUrl(model), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!upstream.ok) {
    return new Response(await upstream.text(), { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
}

async function proxyOpenAI(body: LLMProxyRequestBody, apiKey: string): Promise<Response> {
  const model = body.model ?? 'gpt-4o-mini';
  const contentsArray = body.contents as unknown[];
  const messages: unknown[] = [
    { role: 'system', content: body.systemPrompt },
    ...contentsArray,
  ];
  if (body.userMessage) {
    messages.push({ role: 'user', content: body.userMessage });
  }

  const payload: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.7,
  };
  if (body.tools) payload.tools = body.tools;

  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!upstream.ok) {
    return new Response(await upstream.text(), { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
}

async function proxyAnthropic(body: LLMProxyRequestBody, apiKey: string): Promise<Response> {
  const model = body.model ?? 'claude-sonnet-4-20250514';
  const contentsArray = body.contents as unknown[];

  const payload: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    system: body.systemPrompt,
    messages: [
      ...contentsArray,
      ...(body.userMessage ? [{ role: 'user', content: body.userMessage }] : []),
    ],
    stream: true,
  };
  if (body.tools) payload.tools = body.tools;

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(payload),
  });

  if (!upstream.ok) {
    return new Response(await upstream.text(), { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
}
