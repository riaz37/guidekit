import { test, expect } from '@playwright/test';
import {
  geminiNavigateSse,
  geminiSearchSiteSse,
  geminiTextStopSse,
  mockLlmToolSequenceRoute,
  sendWidgetMessage,
} from '../fixtures/mock-llm-proxy';

test.describe('Agent Runtime v1', () => {
  test('injects server-backed site knowledge for content outside the current page', async ({ page }) => {
    const systemPrompts: string[] = [];

    await page.route('**/api/guidekit/llm', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }

      const body = (await route.request().postDataJSON()) as { systemPrompt?: string };
      systemPrompts.push(body.systemPrompt ?? '');
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        body: geminiTextStopSse('Agent Runtime uses server-backed site knowledge.'),
      });
    });

    await page.goto('/plain');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
    await sendWidgetMessage(page, 'What does the Agent Runtime combine?');

    const assistant = page.locator('.gk-message[data-role="assistant"]').last();
    await expect(assistant).toContainText('server-backed site knowledge', { timeout: 20_000 });
    expect(systemPrompts.some((prompt) => prompt.includes('The Agent Runtime combines server-backed site knowledge'))).toBe(true);
  });

  test('can search site knowledge, navigate to a result, and rescan the destination page', async ({ page }) => {
    await mockLlmToolSequenceRoute(page, [
      geminiSearchSiteSse('About GuideKit', 3),
      geminiNavigateSse('/about'),
    ]);

    await page.goto('/plain');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
    await page.waitForFunction(() => window.__guidekitTest != null, undefined, { timeout: 20_000 });

    await sendWidgetMessage(page, 'Find the About page and take me there.');

    await page.waitForURL('**/about', { timeout: 30_000 });
    await expect(page.locator('h1')).toContainText('About GuideKit');
    await expect(page.locator('[data-testid="guidekit-panel"]')).toHaveAttribute('data-open', 'true');
    await expect(page.locator('.gk-message[data-role="user"]').last()).toContainText('Find the About page');
    await page.waitForFunction(() => window.__guidekitTest != null, undefined, { timeout: 20_000 });
    await page.evaluate(() => window.__guidekitTest!.waitForReady(20_000));

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const model = window.__guidekitTest!.getPageModel() as {
              sections?: Array<{ id?: string; label?: string }>;
            };
            return model.sections?.some(
              (section) => section.id === 'mission' || section.label === 'Our Mission',
            ) ?? false;
          }),
        { timeout: 20_000 },
      )
      .toBe(true);
  });
});
