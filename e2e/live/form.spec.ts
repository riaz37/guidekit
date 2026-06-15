import { test, expect } from '@playwright/test';
import { isLiveLlmEnabled, liveSkipReason } from '../env';
import {
  gotoHomeWithWidget,
  sendChatMessage,
  waitForAssistantReply,
  waitForSectionInViewport,
} from '../fixtures/live-helpers';

test.describe('Live form guidance', () => {
  test.skip(!isLiveLlmEnabled(), liveSkipReason());
  test.describe.configure({ timeout: 120_000, retries: 2 });

  test.beforeEach(async ({ page }) => {
    await gotoHomeWithWidget(page);
  });

  test('real LLM scrolls to contact and mentions the form', async ({ page }) => {
    await sendChatMessage(
      page,
      'Use scrollToSection with sectionId "contact" to show the contact form. Then briefly mention the name field.',
    );

    await waitForSectionInViewport(page, '#contact', 60_000);
    const reply = await waitForAssistantReply(page, { timeout: 75_000, minLength: 5 });
    expect(reply.toLowerCase()).toMatch(/contact|name|form/);
  });
});
