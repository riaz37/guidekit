import { test, expect } from '@playwright/test';
import { isLiveLlmEnabled, liveSkipReason } from '../env';
import {
  gotoHomeWithWidget,
  openWidgetInput,
  waitForLlmResponse,
} from '../fixtures/live-helpers';

const voiceLiveEnabled =
  isLiveLlmEnabled() && process.env.SKIP_LIVE_VOICE !== '1';

// Web Speech does not produce transcripts in headless Chromium.
test.use({ headless: false });

/**
 * Live voice — real Web Speech STT (Chromium fake-audio-capture) + real LLM.
 * This is an explicit live verification: it FAILS if STT doesn't reach the LLM proxy.
 */
test.describe('Live voice integration', () => {
  test.skip(!voiceLiveEnabled, liveSkipReason());
  test.describe.configure({ timeout: 180_000, retries: 1, mode: 'serial' });

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['microphone']);
    await gotoHomeWithWidget(page);
  });

  test('voice transcript reaches real LLM and assistant replies', async ({ page }) => {
    await openWidgetInput(page);

    const mic = page.locator('.gk-mic-btn');
    await expect(mic).toBeVisible();

    const llmResponse = waitForLlmResponse(page, 120_000);
    await mic.click();

    await expect(page.locator('.gk-header-status')).toContainText(/Listening|Online/i, {
      timeout: 60_000,
    });

    await llmResponse;

    const assistant = page.locator('.gk-message[data-role="assistant"]').last();
    await expect(assistant).not.toHaveText('', { timeout: 60_000 });
    const text = (await assistant.textContent())?.trim() ?? '';
    expect(text.length).toBeGreaterThan(0);
    expect(text.toLowerCase()).not.toContain('error:');
  });
});
