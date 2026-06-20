import { test, expect } from '@playwright/test';
import { isLiveLlmEnabled, liveSkipReason } from '../env';

test.describe('Live headless custom UI', () => {
  test.skip(!isLiveLlmEnabled(), liveSkipReason());
  test.describe.configure({ timeout: 120_000, retries: 2 });

  test('headless route mounts custom UI without default widget FAB', async ({ page }) => {
    await page.goto('/headless');
    await page.waitForSelector('[data-testid="guidekit-custom-fab"]', { timeout: 20_000 });

    await expect(page.locator('#guidekit-widget')).toHaveCount(0);
    await expect(page.locator('.gk-fab')).toHaveCount(0);
    await expect(page.locator('[data-testid="guidekit-custom-fab"]')).toBeVisible();
  });

  test('custom panel sends text and shows real assistant reply', async ({ page }) => {
    await page.goto('/headless');
    await page.waitForSelector('[data-testid="guidekit-custom-fab"]', { timeout: 20_000 });
    await page.waitForFunction(() => window.__guidekitTest != null, undefined, { timeout: 20_000 });
    await page.evaluate(async () => {
      await window.__guidekitTest?.waitForReady(20_000);
    });

    await page.locator('[data-testid="guidekit-custom-fab"]').click();
    await expect(page.locator('[data-testid="guidekit-custom-panel"]')).toBeVisible();

    const input = page.locator('[data-testid="guidekit-custom-input"]');
    await expect(input).toBeEnabled({ timeout: 60_000 });

    const llmResponse = page.waitForResponse(
      (res) =>
        res.url().includes('/api/guidekit/llm') &&
        res.request().method() === 'POST' &&
        res.status() === 200,
      { timeout: 75_000 },
    );

    await input.fill('In one short sentence, what page is this?');
    await page.locator('[data-testid="guidekit-custom-send"]').click();
    await llmResponse;

    const assistant = page.locator('[data-testid="guidekit-custom-message-assistant"]').last();
    const text = (await assistant.textContent())?.trim() ?? '';
    expect(text.length).toBeGreaterThan(5);
    expect(text.toLowerCase()).not.toContain('error:');
    expect(text.toLowerCase()).not.toContain('mock');
  });
});
