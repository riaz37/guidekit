import { test, expect } from '@playwright/test';
import { isLiveLlmEnabled, liveSkipReason } from '../env';
import {
  gotoHomeWithWidget,
  sendChatMessage,
  toolOnlyPrompt,
  waitForSpotlight,
} from '../fixtures/live-helpers';

test.describe('Live agent tour', () => {
  test.skip(!isLiveLlmEnabled(), liveSkipReason());
  test.describe.configure({ timeout: 120_000, retries: 2 });

  test.beforeEach(async ({ page }) => {
    await gotoHomeWithWidget(page);
  });

  test('startTour highlights the first tour section', async ({ page }) => {
    await sendChatMessage(
      page,
      toolOnlyPrompt('startTour', 'sectionIds ["hero","pricing"] and mode "auto"'),
    );
    await waitForSpotlight(page, 60_000);
    await expect(page.locator('#hero')).toBeVisible();
    await expect(page.locator('[data-guidekit-tooltip-body]')).toContainText('Step 1 of 2');
  });
});
