import { test, expect } from '@playwright/test';
import { geminiTextStopSse } from '../fixtures/mock-llm-proxy';

test.describe('Headless custom UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/guidekit/llm', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        body: geminiTextStopSse('Headless reply from mock LLM.'),
      });
    });
  });

  test('headless route mounts custom UI without default widget FAB', async ({ page }) => {
    await page.goto('/headless');
    await page.waitForSelector('[data-testid="guidekit-custom-fab"]', { timeout: 20_000 });

    await expect(page.locator('#guidekit-widget')).toHaveCount(0);
    await expect(page.locator('.gk-fab')).toHaveCount(0);
    await expect(page.locator('[data-testid="guidekit-custom-fab"]')).toBeVisible();
  });

  test('custom panel sends text and shows mocked assistant reply', async ({ page }) => {
    await page.goto('/headless');
    await page.waitForSelector('[data-testid="guidekit-custom-fab"]', { timeout: 20_000 });
    await page.evaluate(async () => {
      await window.__guidekitTest?.waitForReady(20_000);
    });

    await page.locator('[data-testid="guidekit-custom-fab"]').click();
    await expect(page.locator('[data-testid="guidekit-custom-panel"]')).toBeVisible();

    const input = page.locator('[data-testid="guidekit-custom-input"]');
    await expect(input).toBeEnabled({ timeout: 15_000 });

    const llmResponse = page.waitForResponse(
      (res) =>
        res.url().includes('/api/guidekit/llm') &&
        res.request().method() === 'POST' &&
        res.status() === 200,
    );

    await input.fill('Hello headless');
    await page.locator('[data-testid="guidekit-custom-send"]').click();
    await llmResponse;

    await expect(
      page.locator('[data-testid="guidekit-custom-message-assistant"]').last(),
    ).toContainText('Headless reply from mock LLM.', { timeout: 15_000 });
  });
});
