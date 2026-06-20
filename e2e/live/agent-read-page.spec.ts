import { test, expect } from '@playwright/test';
import { isLiveLlmEnabled, liveSkipReason } from '../env';
import { gotoHomeWithWidget, sendChatMessage, waitForAssistantReply } from '../fixtures/live-helpers';

test.describe('Live agent read page', () => {
  test.skip(!isLiveLlmEnabled(), liveSkipReason());
  test.describe.configure({ timeout: 120_000, retries: 2 });

  test.beforeEach(async ({ page }) => {
    await gotoHomeWithWidget(page);
  });

  test('readPageContent tool leads to assistant summary', async ({ page }) => {
    await sendChatMessage(page, 'What is in the hero section? Reply briefly.');
    const reply = await waitForAssistantReply(page, { timeout: 75_000, minLength: 5 });
    expect(reply.toLowerCase()).toMatch(/hero|welcome/);
  });
});
