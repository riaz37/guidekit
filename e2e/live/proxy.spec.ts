import { test, expect } from '@playwright/test';
import { isLiveLlmEnabled, liveSkipReason } from '../env';
import {
  fetchSessionToken,
  invalidateSessionToken,
  openWidgetInput,
} from '../fixtures/live-helpers';

/**
 * Live proxy API — direct HTTP against running example app.
 * Run: pnpm test:e2e:live
 */
test.describe('Live proxy API', () => {
  test.skip(!isLiveLlmEnabled(), liveSkipReason());
  test.describe.configure({ timeout: 90_000, retries: 2 });

  test('LLM proxy streams with valid session token', async ({ request }) => {
    const token = await fetchSessionToken(request);
    const res = await request.post('/api/guidekit/llm', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        provider: 'gemini',
        model: 'gemini-2.5-flash-lite',
        systemPrompt: 'You are a helpful assistant.',
        contents: [],
        userMessage: 'Reply with exactly: PROXY_OK',
        stream: true,
      },
    });
    const body = await res.text();
    if (!res.ok() && /(high demand|unavailable|503)/i.test(body)) {
      test.skip(true, 'Gemini returned a transient 503 (high demand). Retry later.');
    }
    expect(res.ok()).toBeTruthy();
    expect(body.length).toBeGreaterThan(20);
    expect(body.toLowerCase()).toContain('proxy_ok');
  });

  test('LLM proxy rejects missing bearer token', async ({ request }) => {
    const res = await request.post('/api/guidekit/llm', {
      data: {
        provider: 'gemini',
        systemPrompt: 'test',
        contents: [],
        userMessage: 'hi',
      },
    });
    expect(res.status()).toBe(401);
  });

  test('stale session returns 401 with recovery hint', async ({ request }) => {
    const res = await request.post('/api/guidekit/llm', {
      headers: { Authorization: 'Bearer invalid.jwt.token' },
      data: {
        provider: 'gemini',
        systemPrompt: 'test',
        contents: [],
        userMessage: 'hi',
      },
    });
    expect(res.status()).toBe(401);
    const body = await res.text();
    expect(body.toLowerCase()).toMatch(/invalid|token|session/);
  });
});

/**
 * Client-side session recovery when server session keys are cleared.
 */
test.describe('Live session recovery', () => {
  test.skip(!isLiveLlmEnabled(), liveSkipReason());
  test.describe.configure({ timeout: 120_000, retries: 2 });

  test('widget recovers after stale session 401 on LLM proxy', async ({ page, request }) => {
    const tokenResponse = page.waitForResponse(
      (res) => res.url().includes('/api/guidekit/token') && res.request().method() === 'POST',
    );
    await page.goto('/');
    await page.waitForSelector('#guidekit-widget', { timeout: 20_000 });
    const tokenRes = await tokenResponse;
    const { token } = (await tokenRes.json()) as { token: string };
    await invalidateSessionToken(request, token);

    let llmCalls = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/guidekit/llm') && req.method() === 'POST') {
        llmCalls += 1;
      }
    });

    const input = await openWidgetInput(page);
    await input.fill('Reply with exactly: RECOVERED');
    await page.locator('.gk-send-btn').click();

    const assistant = page.locator('.gk-message[data-role="assistant"]').last();
    await expect(assistant).not.toHaveText('', { timeout: 90_000 });
    const text = ((await assistant.textContent()) ?? '').trim();
    if (/(high demand|unavailable|503)/i.test(text)) {
      test.skip(
        true,
        'Gemini returned a transient 503 (high demand). Recovery path was exercised; retry later for full assertion.',
      );
    }
    expect(text).toMatch(/RECOVERED/i);
    expect(llmCalls).toBeGreaterThanOrEqual(2);
  });
});
