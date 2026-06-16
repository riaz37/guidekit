/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleLLMProxy } from './llm.js';
import { createSessionToken } from '../auth.js';
import { InMemorySessionStore } from '../session-store.js';

const TEST_SECRET = 'test-secret-that-is-long-enough-for-hmac-256-bits!!';

async function authedProxyRequest(
  body: Record<string, unknown>,
  store = new InMemorySessionStore(),
): Promise<{ request: Request; store: InMemorySessionStore }> {
  const { token } = await createSessionToken({
    signingSecret: TEST_SECRET,
    sessionId: 'sse-contract-session',
    llmApiKey: 'test-llm-key',
    sessionStore: store,
  });

  const request = new Request('http://localhost/api/guidekit/llm', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return { request, store };
}

describe('handleLLMProxy SSE contract', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('passes through Gemini SSE with text/event-stream headers', async () => {
    const sseBody = 'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}\n\n';
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    ) as typeof fetch;

    const { request, store } = await authedProxyRequest({
      provider: 'gemini',
      systemPrompt: 'test',
      contents: [],
      userMessage: 'hello',
    });

    const res = await handleLLMProxy(request, {
      signingSecret: TEST_SECRET,
      sessionStore: store,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(await res.text()).toBe(sseBody);

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('generativelanguage.googleapis.com');
    expect(calledUrl).toContain('streamGenerateContent');
  });

  it('passes through OpenAI SSE with text/event-stream headers', async () => {
    const sseBody = 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n';
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    ) as typeof fetch;

    const { request, store } = await authedProxyRequest({
      provider: 'openai',
      systemPrompt: 'test',
      contents: [],
      userMessage: 'hello',
    });

    const res = await handleLLMProxy(request, {
      signingSecret: TEST_SECRET,
      sessionStore: store,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(await res.text()).toBe(sseBody);

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('passes through Anthropic SSE with text/event-stream headers', async () => {
    const sseBody =
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"Hi"}}\n\n';
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    ) as typeof fetch;

    const { request, store } = await authedProxyRequest({
      provider: 'anthropic',
      systemPrompt: 'test',
      contents: [],
      userMessage: 'hello',
    });

    const res = await handleLLMProxy(request, {
      signingSecret: TEST_SECRET,
      sessionStore: store,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(await res.text()).toBe(sseBody);

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe('https://api.anthropic.com/v1/messages');
  });

  it('rejects requests when llm permission is not granted', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    const store = new InMemorySessionStore();
    const { token } = await createSessionToken({
      signingSecret: TEST_SECRET,
      sessionId: 'no-llm-perm',
      llmApiKey: 'test-llm-key',
      permissions: ['stt', 'tts'],
      sessionStore: store,
    });

    const request = new Request('http://localhost/api/guidekit/llm', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'gemini',
        systemPrompt: 'test',
        contents: [],
        userMessage: 'hello',
      }),
    });

    const res = await handleLLMProxy(request, {
      signingSecret: TEST_SECRET,
      sessionStore: store,
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Permission "llm"');
  });

  it('enforces allowedOrigins when token includes aud', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    const store = new InMemorySessionStore();
    const { token } = await createSessionToken({
      signingSecret: TEST_SECRET,
      sessionId: 'origin-check',
      llmApiKey: 'test-llm-key',
      allowedOrigins: ['https://app.example.com'],
      sessionStore: store,
    });

    const request = new Request('http://localhost/api/guidekit/llm', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://evil.example.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'gemini',
        systemPrompt: 'test',
        contents: [],
        userMessage: 'hello',
      }),
    });

    const res = await handleLLMProxy(request, {
      signingSecret: TEST_SECRET,
      sessionStore: store,
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Origin');
  });

  it('validates request body shape', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    const { request, store } = await authedProxyRequest({
      provider: 'gemini',
      systemPrompt: '',
      contents: 'not-an-array',
    });

    const res = await handleLLMProxy(request, {
      signingSecret: TEST_SECRET,
      sessionStore: store,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid body');
  });
});
