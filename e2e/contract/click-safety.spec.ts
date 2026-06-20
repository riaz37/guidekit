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

  test('submit buttons blocked by default deny list', async ({ page }) => {
    await page.evaluate(() => {
      const form = document.createElement('form');
      form.id = 'gk-test-form';
      form.innerHTML = '<button type="submit" id="gk-submit">Pay now</button>';
      document.body.appendChild(form);
    });

    await mockLlmToolSequenceRoute(page, [geminiClickElementSse('#gk-submit')]);

    const waitForTool = page.evaluate(() =>
      window.__guidekitTest!.waitForEvent('llm:tool-call', 25_000),
    );

    await sendWidgetMessage(page, 'Submit the payment form.');

    const toolEvent = await waitForTool;
    expect((toolEvent.data as { name?: string }).name).toBe('clickElement');
  });
});
