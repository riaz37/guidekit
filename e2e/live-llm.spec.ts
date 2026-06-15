import { test, expect } from '@playwright/test';
import { openWidgetInput } from './fixtures/mock-llm-proxy';

/**
 * Live integration — real Gemini via server proxy (skipped in CI).
 * Run: LIVE_LLM=1 pnpm exec playwright test e2e/live-llm.spec.ts
 */
test.describe('Live LLM integration', () => {
  test.skip(!process.env.LIVE_LLM, 'Set LIVE_LLM=1 to run against a real API key');
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#guidekit-widget', { timeout: 20_000 });
  });

  test('proxy token + health + real assistant reply', async ({ page, request }) => {
    const health = await request.get('/api/guidekit/health');
    expect(health.ok()).toBeTruthy();

    const tokenRes = await request.post('/api/guidekit/token');
    expect(tokenRes.ok()).toBeTruthy();
    const { token } = (await tokenRes.json()) as { token: string };
    expect(token.length).toBeGreaterThan(20);

    const input = await openWidgetInput(page);
    await input.fill('In one short sentence, what is on this page?');
    await page.locator('.gk-send-btn').click();

    const assistant = page.locator('.gk-message[data-role="assistant"]').last();
    await expect(assistant).not.toHaveText('', { timeout: 45_000 });
    const text = (await assistant.textContent())?.trim() ?? '';
    expect(text.length).toBeGreaterThan(10);
    expect(text.toLowerCase()).not.toContain('error:');
  });
});
