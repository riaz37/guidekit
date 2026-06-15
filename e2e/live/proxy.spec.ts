import { test, expect } from '@playwright/test';
import { isLiveLlmEnabled, liveSkipReason } from '../env';
import { fetchSessionToken } from '../fixtures/live-helpers';

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
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
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
 * Client-side session recovery when server session keys are gone.
 * Uses route mock for first 401, then allows real proxy on retry.
 */
test.describe('Live session recovery', () => {
  test.skip(!isLiveLlmEnabled(), liveSkipReason());
  test.describe.configure({ timeout: 90_000, retries: 2 });

  test('widget recovers after stale session 401 on LLM proxy', async ({ page }) => {
    let llmCalls = 0;
    await page.route('**/api/guidekit/llm', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      llmCalls += 1;
      if (llmCalls === 1) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Session expired or server restarted — request a new token',
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/');
    await page.waitForSelector('#guidekit-widget', { timeout: 20_000 });

    const fab = page.locator('.gk-fab');
    await fab.click();
    const input = page.locator('.gk-input');
    await input.waitFor({ state: 'visible', timeout: 10_000 });
    await input.fill('Reply with exactly: RECOVERED');
    await page.locator('.gk-send-btn').click();

    const assistant = page.locator('.gk-message[data-role="assistant"]').last();
    await expect(assistant).toContainText(/RECOVERED/i, { timeout: 60_000 });
    expect(llmCalls).toBeGreaterThanOrEqual(2);
  });
});
