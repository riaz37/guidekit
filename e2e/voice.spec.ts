import { test, expect } from '@playwright/test';
import { openWidgetInput } from './fixtures/mock-llm-proxy';
import {
  installVoiceBrowserMocks,
  mockLlmTextRoute,
} from './fixtures/voice-mocks';

test.describe('Voice smoke', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['microphone']);
    await installVoiceBrowserMocks(page, 'scroll to pricing');
    await mockLlmTextRoute(page, 'Opening the pricing section for you.');
    await page.goto('/');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
  });

  test('mic button is visible when voice pipeline is configured', async ({ page }) => {
    await openWidgetInput(page);
    const mic = page.locator('.gk-mic-btn');
    await expect(mic).toBeVisible();
  });

  test('voice transcript reaches LLM and appears in the widget', async ({ page }) => {
    await openWidgetInput(page);

    const llmResponse = page.waitForResponse(
      (res) =>
        res.url().includes('/api/guidekit/llm') &&
        res.request().method() === 'POST' &&
        res.status() === 200,
      { timeout: 60_000 },
    );

    const mic = page.locator('.gk-mic-btn');
    await mic.click();

    await expect(page.locator('.gk-header-status')).toContainText(/Listening|Online/i, {
      timeout: 45_000,
    });

    await llmResponse;

    await expect(page.locator('.gk-transcript')).toContainText('scroll to pricing', {
      timeout: 15_000,
    });
    await expect(page.locator('.gk-transcript')).toContainText('pricing section', {
      timeout: 15_000,
    });
  });
});
