import { test, expect } from '@playwright/test';

/**
 * Contract tests for proxy security boundaries (no live LLM required).
 */
test.describe('Proxy security boundaries', () => {
  test('LLM proxy rejects missing Authorization', async ({ request }) => {
    const res = await request.post('/api/guidekit/llm', {
      data: {
        provider: 'gemini',
        systemPrompt: 'test',
        contents: [],
        userMessage: 'hello',
      },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Authorization|token/i);
  });

  test('LLM proxy rejects invalid JSON body', async ({ request }) => {
    const tokenRes = await request.post('/api/guidekit/token');
    expect(tokenRes.ok()).toBeTruthy();
    const { token } = (await tokenRes.json()) as { token: string };

    const res = await request.post('/api/guidekit/llm', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: 'not-json',
    });
    expect(res.status()).toBe(400);
  });

  test('LLM proxy rejects empty systemPrompt', async ({ request }) => {
    const tokenRes = await request.post('/api/guidekit/token');
    const { token } = (await tokenRes.json()) as { token: string };

    const res = await request.post('/api/guidekit/llm', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        provider: 'gemini',
        systemPrompt: '',
        contents: [],
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/systemPrompt/i);
  });

  test('STT proxy rejects missing Authorization', async ({ request }) => {
    const res = await request.post('/api/guidekit/stt');
    expect(res.status()).toBe(401);
  });

  test('invalid bearer token is rejected on LLM proxy', async ({ request }) => {
    const res = await request.post('/api/guidekit/llm', {
      headers: { Authorization: 'Bearer not-a-valid-jwt' },
      data: {
        provider: 'gemini',
        systemPrompt: 'test',
        contents: [],
      },
    });
    expect(res.status()).toBe(401);
  });
});
