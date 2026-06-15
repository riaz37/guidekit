import { test, expect } from '@playwright/test';
import { mockLlmTextRoute } from '../fixtures/voice-mocks';
import { openWidgetInput } from '../fixtures/mock-llm-proxy';

test.describe('Knowledge retrieval', () => {
  test.beforeEach(async ({ page }) => {
    await mockLlmTextRoute(
      page,
      'API keys are stored server-side only. The client uses a short-lived JWT and the LLM proxy.',
    );
    await page.goto('/');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
  });

  test('assistant answer reflects knowledge base security content', async ({ page }) => {
    const input = await openWidgetInput(page);
    await input.fill('According to the knowledge base, where are API keys stored in production?');
    await page.getByTestId('guidekit-send').click();

    const assistant = page.locator('.gk-message[data-role="assistant"]').last();
    await expect(assistant).toContainText(/server-side|proxy|jwt/i, { timeout: 20_000 });
  });
});
