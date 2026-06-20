import { test } from '@playwright/test';
import { isLiveLlmEnabled, liveSkipReason } from '../env';
import {
  gotoHomeWithWidget,
  sendChatMessage,
  toolOnlyPrompt,
  waitForAssistantReply,
  waitForSpotlight,
  waitForSpotlightDismissed,
} from '../fixtures/live-helpers';

test.describe('Live highlight dismiss', () => {
  test.skip(!isLiveLlmEnabled(), liveSkipReason());
  test.describe.configure({ timeout: 120_000, retries: 2 });

  test.beforeEach(async ({ page }) => {
    await gotoHomeWithWidget(page);
  });

  test('dismissHighlight hides spotlight overlay', async ({ page }) => {
    await sendChatMessage(
      page,
      toolOnlyPrompt('highlight', 'sectionId "hero" and tooltip "Hero section"'),
    );
    await waitForSpotlight(page, 60_000);
    await waitForAssistantReply(page, { timeout: 75_000, minLength: 1 }).catch(() => {
      // Tool-only rounds may not produce a visible assistant message.
    });

    await sendChatMessage(page, toolOnlyPrompt('dismissHighlight', 'no arguments'));
    await waitForSpotlightDismissed(page, 60_000);
  });
});
