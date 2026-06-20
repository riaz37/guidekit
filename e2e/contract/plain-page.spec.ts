import { test, expect } from '@playwright/test';
import {
  geminiHighlightToolSse,
  geminiReadPageContentSse,
  geminiTextStopSse,
  mockLlmToolSequenceRoute,
  sendWidgetMessage,
} from '../fixtures/mock-llm-proxy';

test.describe('Plain page (no annotations)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/plain');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
  });

  test('readPageContent resolves heuristic section', async ({ page }) => {
    await mockLlmToolSequenceRoute(page, [
      geminiReadPageContentSse('intro'),
      geminiTextStopSse('The intro explains heuristic scanning on plain pages.'),
    ]);

    await sendWidgetMessage(page, 'Read the introduction section.');

    await expect(page.locator('.gk-msg-assistant, .gk-message[data-role="assistant"]').last()).toContainText(
      /intro|heuristic|scan/i,
      { timeout: 20_000 },
    );
  });

  test('highlight lands on plain section', async ({ page }) => {
    await mockLlmToolSequenceRoute(page, [geminiHighlightToolSse('features-plain')]);

    await sendWidgetMessage(page, 'Highlight product features.');

    await expect(page.locator('[data-guidekit-spotlight]')).toBeAttached({ timeout: 20_000 });
    await expect(page.locator('#features-plain')).toBeVisible();
  });
});
