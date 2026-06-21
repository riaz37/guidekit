import { test, expect } from '@playwright/test';
import { geminiClickElementSse, mockLlmToolSequenceRoute, sendWidgetMessage } from '../fixtures/mock-llm-proxy';

test.describe('Click safety', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/plain');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
    await page.waitForFunction(() => window.__guidekitTest != null, undefined, { timeout: 20_000 });
  });

  test('dangerous delete action requires confirmation', async ({ page }) => {
    await mockLlmToolSequenceRoute(page, [geminiClickElementSse('#danger-delete')]);

    await page.evaluate(() => {
      (window as any).__gkDangerClicked = false;
      document.querySelector('#danger-delete')?.addEventListener('click', () => {
        (window as any).__gkDangerClicked = true;
      });
    });

    const waitForConfirmation = page.evaluate(() =>
      window.__guidekitTest!.waitForEvent('action:confirmation-required', 30_000),
    );

    await sendWidgetMessage(page, 'Click delete account.');

    const event = await waitForConfirmation;
    expect(event.name).toBe('action:confirmation-required');
    expect((event.data as { selector?: string }).selector).toContain('danger-delete');

    const clicked = await page.evaluate(() => Boolean((window as any).__gkDangerClicked));
    expect(clicked).toBe(false);
  });

  test('purchase actions require confirmation by autonomy policy', async ({ page }) => {
    await page.evaluate(() => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'gk-pay-now';
      button.textContent = 'Pay now';
      document.body.appendChild(button);
    });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const model = window.__guidekitTest!.getPageModel() as {
              interactiveElements?: Array<{ selector?: string; actionRisk?: string }>;
            } | null;
            return model?.interactiveElements?.some(
              (element) => element.selector === '#gk-pay-now' && element.actionRisk === 'purchase',
            ) ?? false;
          }),
        { timeout: 10_000 },
      )
      .toBe(true);

    await mockLlmToolSequenceRoute(page, [geminiClickElementSse('#gk-pay-now')]);

    const waitForConfirmation = page.evaluate(() =>
      window.__guidekitTest!.waitForEvent('action:confirmation-required', 25_000),
    );

    await sendWidgetMessage(page, 'Click pay now.');

    const event = await waitForConfirmation;
    expect((event.data as { selector?: string; risk?: string }).selector).toBe('#gk-pay-now');
    expect((event.data as { selector?: string; risk?: string }).risk).toBe('purchase');
  });
});
