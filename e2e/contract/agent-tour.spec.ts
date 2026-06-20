import { test, expect } from '@playwright/test';
import {
  geminiStartTourSse,
  mockLlmToolRoute,
  openWidgetInput,
} from '../fixtures/mock-llm-proxy';

test.describe('Agent tour', () => {
  test.beforeEach(async ({ page }) => {
    await mockLlmToolRoute(page, geminiStartTourSse(['hero', 'pricing']));
    await page.goto('/');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
  });

  test('startTour highlights the first tour section', async ({ page }) => {
    const input = await openWidgetInput(page);
    await input.fill('Start a tour of hero and pricing');
    await page.getByTestId('guidekit-send').click();

    await expect(page.locator('[data-guidekit-spotlight]')).toBeAttached({ timeout: 20_000 });
    await expect(page.locator('#hero')).toBeVisible();
    await expect(page.locator('[data-guidekit-tooltip-body]')).toContainText('Step 1 of 2');
  });

  test('startTour Next control advances to the next section', async ({ page }) => {
    const input = await openWidgetInput(page);
    await input.fill('Start a tour of hero and pricing');
    await page.getByTestId('guidekit-send').click();

    await expect(page.locator('[data-guidekit-spotlight]')).toBeAttached({ timeout: 20_000 });
    await page.locator('[data-guidekit-tour-next]').click();
    await expect(page.locator('[data-guidekit-tooltip-body]')).toContainText('Step 2 of 2', {
      timeout: 10_000,
    });
    await expect(page.locator('#pricing')).toBeVisible();
  });
});
