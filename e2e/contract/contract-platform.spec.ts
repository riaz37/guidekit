import { test, expect } from '@playwright/test';
import { mockLlmTextRoute } from '../fixtures/voice-mocks';
import { openWidgetInput } from '../fixtures/mock-llm-proxy';

/**
 * Platform Mode pipeline contracts — no live API key (runs in CI).
 */
test.describe('Contract Platform Mode', () => {
  test.beforeEach(async ({ page }) => {
    await mockLlmTextRoute(page, 'Platform pipeline check.');
    await page.goto('/');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
  });

  test('platform-demo plugin appends footer to assistant response', async ({ page }) => {
    const input = await openWidgetInput(page);
    await input.fill('Run platform check');
    await page.locator('.gk-send-btn').click();

    const assistant = page.locator('.gk-message[data-role="assistant"]').last();
    await expect(assistant).toContainText('Platform pipeline check', { timeout: 20_000 });
    await expect(assistant).toContainText('[Platform Mode]', { timeout: 20_000 });
  });

  test('widget initializes with platform mode provider options', async ({ page }) => {
    const health = await page.request.get('/api/guidekit/health');
    expect(health.ok()).toBeTruthy();

    const fab = page.locator('.gk-fab');
    await fab.click();
    const input = page.locator('.gk-input');
    await expect(input).toBeVisible({ timeout: 10_000 });

    const mic = page.locator('.gk-mic-btn');
    await expect(mic).toBeVisible();
  });
});
