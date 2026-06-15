import { test, expect } from '@playwright/test';
import {
  geminiClickElementSse,
  geminiScrollToSectionSse,
  geminiTextStopSse,
  mockLlmToolSequenceRoute,
  openWidgetInput,
} from '../fixtures/mock-llm-proxy';

test.describe('Agent clickElement', () => {
  test.beforeEach(async ({ page }) => {
    await mockLlmToolSequenceRoute(page, [
      geminiScrollToSectionSse('contact'),
      geminiClickElementSse('#name'),
      geminiTextStopSse('Clicked.'),
    ]);
    await page.goto('/');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
  });

  test('clickElement focuses allowed input', async ({ page }) => {
    await page.waitForSelector('#name');
    await page.evaluate(() => {
      (window as any).__gkClickedName = false;
      const el = document.querySelector('#name');
      if (el) {
        el.addEventListener('click', () => {
          (window as any).__gkClickedName = true;
        });
      }
    });

    const input = await openWidgetInput(page);
    await input.fill('Click the name field in the contact form.');
    await page.getByTestId('guidekit-send').click();

    await expect(page.locator('#contact')).toBeVisible({ timeout: 20_000 });
    const nameInput = page.locator('#name');
    await expect(nameInput).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => Boolean((window as any).__gkClickedName)), { timeout: 15_000 })
      .toBe(true);
  });
});

