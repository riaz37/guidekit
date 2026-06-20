import { test, expect } from '@playwright/test';
import { isLiveLlmEnabled, liveSkipReason } from '../env';
import {
  gotoHomeWithWidget,
  installClickListener,
  sendChatMessage,
  toolOnlyPrompt,
  waitForAssistantReply,
  wasElementClicked,
} from '../fixtures/live-helpers';

test.describe('Live agent clickElement', () => {
  test.skip(!isLiveLlmEnabled(), liveSkipReason());
  test.describe.configure({ timeout: 120_000, retries: 2 });

  test.beforeEach(async ({ page }) => {
    await gotoHomeWithWidget(page);
    await page.waitForSelector('#name');
    await installClickListener(page, '#name', '__gkClickedName');
  });

  test('clickElement focuses allowed input', async ({ page }) => {
    await sendChatMessage(page, toolOnlyPrompt('scrollToSection', 'sectionId "contact"'));
    await expect(page.locator('#contact')).toBeVisible({ timeout: 60_000 });

    await sendChatMessage(page, toolOnlyPrompt('clickElement', 'selector "#name"'));
    await waitForAssistantReply(page, { timeout: 75_000, minLength: 1 }).catch(() => {
      // Tool-only rounds may not produce a visible assistant message.
    });

    await expect
      .poll(() => wasElementClicked(page, '__gkClickedName'), { timeout: 30_000 })
      .toBe(true);
  });
});
