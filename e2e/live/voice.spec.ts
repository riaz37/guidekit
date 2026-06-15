import { test, expect } from '@playwright/test';
import { isLiveLlmEnabled, liveSkipReason } from '../env';
import { gotoHomeWithWidget, waitForLlmResponse } from '../fixtures/live-helpers';
import { openWidgetInput } from '../fixtures/mock-llm-proxy';
import { setupVoiceE2e } from '../fixtures/voice-e2e';

/**
 * Live voice — mocked Web Speech STT + real LLM (no STT/TTS API keys).
 * Run: pnpm test:e2e:live
 */
test.describe('Live voice integration', () => {
  test.skip(!isLiveLlmEnabled(), liveSkipReason());
  test.describe.configure({ timeout: 120_000, retries: 1 });

  test.beforeEach(async ({ page, context }) => {
    await setupVoiceE2e(page, context, 'scroll to the pricing section');
    await gotoHomeWithWidget(page);
  });

  test('voice transcript reaches real LLM and assistant replies', async ({ page }) => {
    await openWidgetInput(page);

    const llmResponse = waitForLlmResponse(page, 75_000);
    const mic = page.locator('.gk-mic-btn');
    await mic.click();

    await expect(page.locator('.gk-header-status')).toContainText(/Listening|Online/i, {
      timeout: 45_000,
    });

    await llmResponse;

    const userBubble = page.locator('.gk-message[data-role="user"]').last();
    await expect(userBubble).toContainText(/pricing|scroll/i, { timeout: 20_000 });

    const assistant = page.locator('.gk-message[data-role="assistant"]').last();
    await expect(assistant).not.toHaveText('', { timeout: 45_000 });
    const text = (await assistant.textContent())?.trim() ?? '';
    expect(text.length).toBeGreaterThan(5);
    expect(text.toLowerCase()).not.toContain('error:');
  });
});
