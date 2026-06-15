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
    const firstTurn = 'Remember this codeword: ORBIT42. Reply with only OK.';
    await sendChatMessage(page, firstTurn);
    await waitForAssistantReply(page, { minLength: 1 });
    await expect(page.locator('.gk-processing')).toBeHidden({ timeout: 60_000 });

    const secondTurn = 'What codeword did I ask you to remember? Reply with only the codeword.';
    const secondRequest = page.waitForRequest((req) => {
      if (!req.url().includes('/api/guidekit/llm') || req.method() !== 'POST') return false;
      try {
        const body = req.postDataJSON() as { userMessage?: string; contents?: unknown[] };
        return body.userMessage === secondTurn;
      } catch {
        return false;
      }
    });

    await sendChatMessage(page, secondTurn);

    const req = await secondRequest;
    const body = req.postDataJSON() as { contents?: Array<{ role?: string; parts?: Array<{ text?: string }> }> };
    const historyText = JSON.stringify(body.contents ?? []);
    expect(historyText).toContain('ORBIT42');

    // Still wait for a reply as a smoke check, but do not depend on model compliance.
    await waitForAssistantReply(page, { minLength: 1 });
  });
});
