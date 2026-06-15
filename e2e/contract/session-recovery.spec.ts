import { test, expect } from '@playwright/test';
import { geminiTextSse } from '../fixtures/voice-mocks';

/** Contract session recovery when live LLM is unavailable (CI). */
test.describe('Contract session recovery', () => {
  test('widget retries LLM after mocked stale session 401', async ({ page }) => {
    let llmCalls = 0;
    await page.route('**/api/guidekit/llm', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      llmCalls += 1;
      if (llmCalls === 1) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Session expired or server restarted — request a new token',
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        body: geminiTextSse('Session recovered successfully.'),
      });
    });

    await page.goto('/');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
    const fab = page.locator('.gk-fab');
    await fab.click();
    const input = page.locator('.gk-input');
    await input.waitFor({ state: 'visible' });
    await input.fill('Hello after recovery');
    await page.locator('.gk-send-btn').click();

    await expect(page.locator('.gk-message[data-role="assistant"]').last()).toContainText(
      'Session recovered',
      { timeout: 20_000 },
    );
    expect(llmCalls).toBe(2);
  });
});
