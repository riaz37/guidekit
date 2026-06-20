import { test, expect } from '@playwright/test';
import { sendWidgetMessage } from '../fixtures/mock-llm-proxy';
import { mockLlmTextRoute } from '../fixtures/voice-mocks';

test.describe('SPA DOM rescan', () => {
  test('page model hash updates after DOM swap', async ({ page }) => {
    await mockLlmTextRoute(page, 'Content swapped.');
    await page.goto('/spa-rescan');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
    await page.waitForFunction(() => window.__guidekitTest != null, undefined, { timeout: 20_000 });

    await page.evaluate(async () => {
      await window.__guidekitTest!.waitForReady();
    });

    const hashBefore = await page.evaluate(
      () => (window.__guidekitTest!.getPageModel() as { hash?: string } | null)?.hash ?? null,
    );

    await page.evaluate(() => window.__guidekitTest!.clear());

    await page.locator('#swap-content').click({ force: true });
    await expect(page.locator('#panel-beta')).toBeVisible({ timeout: 10_000 });

    await page.evaluate(() =>
      window.__guidekitTest!.waitForEvent('dom:scan-complete', 20_000),
    );

    await expect
      .poll(
        async () => {
          await page.evaluate(async () => {
            await window.__guidekitTest!.waitForReady();
          });
          const model = await page.evaluate(
            () => window.__guidekitTest!.getPageModel() as { hash?: string } | null,
          );
          return model?.hash ?? null;
        },
        { timeout: 25_000 },
      )
      .not.toBe(hashBefore);

    await sendWidgetMessage(page, 'What panel is visible now?');
    await expect(page.locator('.gk-msg-assistant, .gk-message[data-role="assistant"]').last()).toBeVisible({
      timeout: 20_000,
    });
  });
});
