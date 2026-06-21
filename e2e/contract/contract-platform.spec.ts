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

  test('platform mode pipeline completes without demo footer', async ({ page }) => {
    await page.waitForFunction(() => window.__guidekitTest != null, undefined, { timeout: 20_000 });
    await page.evaluate(() => window.__guidekitTest!.waitForReady(20_000));

    const validationPromise = page.evaluate(() =>
      window.__guidekitTest!.waitForEvent('validation:complete', 45_000),
    );

    const input = await openWidgetInput(page);
    await input.fill('Run platform check');
    await page.locator('.gk-send-btn').click();

    const assistant = page.locator('.gk-message[data-role="assistant"]').last();
    await expect(assistant).toContainText('Platform pipeline check', { timeout: 20_000 });
    await expect(assistant).not.toContainText('[Platform Mode]');
    await expect(assistant).not.toContainText('Response validated by');

    const event = await validationPromise;
    expect(event.name).toBe('validation:complete');
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
