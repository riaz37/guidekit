import { test, expect } from '@playwright/test';
import { mockLlmTextRoute } from '../fixtures/voice-mocks';
import { openWidgetInput } from '../fixtures/mock-llm-proxy';

test.describe('Cognitive engine', () => {
  test.beforeEach(async ({ page }) => {
    await mockLlmTextRoute(page, 'Cognitive planning complete. The overview section describes the demo.');
    await page.goto('/demo');
    await page.waitForSelector('#guidekit-widget', { timeout: 20_000 });
  });

  test('cognitive demo page returns assistant reply', async ({ page }) => {
    const input = await openWidgetInput(page);
    await input.fill('Summarize the overview section.');
    await page.getByTestId('guidekit-send').click();

    const assistant = page.locator('.gk-message[data-role="assistant"]').last();
    await expect(assistant).toContainText(/overview|cognitive|demo/i, { timeout: 25_000 });
  });
});
