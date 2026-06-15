import { test, expect } from '@playwright/test';
import {
  geminiReadPageContentSse,
  geminiTextStopSse,
  mockLlmToolSequenceRoute,
  openWidgetInput,
} from '../fixtures/mock-llm-proxy';

test.describe('Agent read page', () => {
  test.beforeEach(async ({ page }) => {
    await mockLlmToolSequenceRoute(page, [
      geminiReadPageContentSse('hero'),
      geminiTextStopSse('The hero section welcomes users to the test application.'),
    ]);
    await page.goto('/');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
  });

  test('readPageContent tool leads to assistant summary', async ({ page }) => {
    const input = await openWidgetInput(page);
    await input.fill('What is in the hero section?');
    await page.getByTestId('guidekit-send').click();

    const assistant = page.locator('.gk-message[data-role="assistant"]').last();
    await expect(assistant).toContainText(/hero|welcome/i, { timeout: 25_000 });
  });
});
