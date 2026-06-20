import { test, expect } from '@playwright/test';
import { mockLlmTextRoute } from '../fixtures/voice-mocks';
import { sendWidgetMessage } from '../fixtures/mock-llm-proxy';

test.describe('Hallucination guard', () => {
  test.beforeEach(async ({ page }) => {
    await mockLlmTextRoute(page, 'The hero section welcomes you to GuideKit.');
    await page.goto('/');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
    await page.waitForFunction(() => window.__guidekitTest != null, undefined, { timeout: 20_000 });
  });

  test('validation:complete bus event fires after response', async ({ page }) => {
    const waitForValidation = page.evaluate(() =>
      window.__guidekitTest!.waitForEvent('validation:complete', 45_000),
    );

    await sendWidgetMessage(page, 'Describe the hero section.');

    const event = await waitForValidation;
    expect(event.name).toBe('validation:complete');
    expect(event.data).toBeTruthy();
  });
});
