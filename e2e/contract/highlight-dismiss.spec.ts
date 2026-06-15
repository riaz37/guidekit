import { test, expect } from '@playwright/test';
import {
  geminiDismissHighlightSse,
  geminiHighlightToolSse,
  mockLlmToolSequenceRoute,
  openWidgetInput,
} from '../fixtures/mock-llm-proxy';

test.describe('Highlight dismiss', () => {
  test.beforeEach(async ({ page }) => {
    await mockLlmToolSequenceRoute(page, [
      geminiHighlightToolSse('hero'),
      geminiDismissHighlightSse(),
    ]);
    await page.goto('/');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
  });

  test('dismissHighlight hides spotlight overlay', async ({ page }) => {
    const input = await openWidgetInput(page);
    await input.fill('Highlight hero then dismiss');
    await page.getByTestId('guidekit-send').click();

    const spotlight = page.locator('[data-guidekit-spotlight]');
    await expect(spotlight).toBeAttached({ timeout: 25_000 });

    await page.waitForFunction(() => {
      const el = document.querySelector('[data-guidekit-spotlight]');
      if (!el) return true;
      return el instanceof HTMLElement && el.style.opacity === '0';
    }, undefined, { timeout: 35_000 });
  });
});
