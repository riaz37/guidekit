import { test, expect } from '@playwright/test';
import { isLiveLlmEnabled, liveSkipReason } from '../env';
import { gotoHomeWithWidget, sendChatMessage, waitForAssistantReply } from '../fixtures/live-helpers';

test.describe('Live custom actions', () => {
  test.skip(!isLiveLlmEnabled(), liveSkipReason());
  test.describe.configure({ timeout: 120_000, retries: 2 });

  test.beforeEach(async ({ page }) => {
    await gotoHomeWithWidget(page);
  });

  test('real LLM invokes showAlert custom action', async ({ page }) => {
    let dialogSeen = false;
    page.on('dialog', async (dialog) => {
      dialogSeen = true;
      await dialog.accept();
    });

    await sendChatMessage(
      page,
      'Use the executeCustomAction tool with actionId "showAlert" and params message "Live E2E alert". Only call the tool.',
    );

    await waitForAssistantReply(page, { timeout: 75_000, minLength: 1 });
    expect(dialogSeen).toBeTruthy();
  });
});
