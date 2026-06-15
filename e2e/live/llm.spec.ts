import { test, expect } from '@playwright/test';
import { isLiveLlmEnabled, liveSkipReason } from '../env';
import {
  fetchSessionToken,
  gotoHomeWithWidget,
  sendChatMessage,
  waitForAssistantReply,
  waitForLlmResponse,
} from '../fixtures/live-helpers';

/**
 * Live integration — real Gemini via server proxy (skipped in CI / without API key).
 * Run: pnpm test:e2e:live
 */
test.describe('Live LLM integration', () => {
  test.skip(!isLiveLlmEnabled(), liveSkipReason());
  test.describe.configure({ timeout: 90_000, retries: 1 });

  test.beforeEach(async ({ page }) => {
    await gotoHomeWithWidget(page);
  });

  test('proxy health + token + real assistant reply', async ({ page, request }) => {
    const health = await request.get('/api/guidekit/health');
    expect(health.ok()).toBeTruthy();
    await fetchSessionToken(request);

    await sendChatMessage(page, 'In one short sentence, what is on this page?');
    const text = await waitForAssistantReply(page);
    expect(text.length).toBeGreaterThan(10);
  });

  test('streaming shows processing indicator then assistant message', async ({ page }) => {
    const llmResponse = waitForLlmResponse(page);
    await sendChatMessage(page, 'Say hello in five words or fewer.');
    await expect(page.locator('.gk-processing')).toBeVisible({ timeout: 15_000 });
    await llmResponse;
    await expect(page.locator('.gk-processing')).toBeHidden({ timeout: 45_000 });
    await waitForAssistantReply(page, { minLength: 3 });
  });

  test('multi-turn conversation retains context', async ({ page }) => {
    await sendChatMessage(page, 'Remember this codeword: ORBIT42. Reply with only OK.');
    await waitForAssistantReply(page, { minLength: 1 });
    await expect(page.locator('.gk-processing')).toBeHidden({ timeout: 60_000 });

    await sendChatMessage(
      page,
      'What codeword did I ask you to remember? Reply with only the codeword.',
    );
    const reply = await waitForAssistantReply(page, { minLength: 4 });
    expect(reply.toUpperCase()).toContain('ORBIT42');
  });
});
