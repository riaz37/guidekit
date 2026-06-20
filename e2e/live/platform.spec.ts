import { test, expect } from '@playwright/test';
import { isLiveLlmEnabled, liveSkipReason } from '../env';
import {
  gotoHomeWithWidget,
  sendChatMessage,
  waitForAssistantReply,
} from '../fixtures/live-helpers';

/**
 * Live Platform Mode — RAG knowledge + plugin hooks with a real LLM.
 * Run: pnpm test:e2e:live
 */
test.describe('Live Platform Mode', () => {
  test.skip(!isLiveLlmEnabled(), liveSkipReason());
  test.describe.configure({ timeout: 90_000, retries: 1 });

  test.beforeEach(async ({ page }) => {
    await gotoHomeWithWidget(page);
  });

  test('knowledge retrieval answers security doc question', async ({ page }) => {
    await sendChatMessage(
      page,
      'According to the knowledge base: where should API keys be stored in production? Answer in one sentence.',
    );
    const reply = await waitForAssistantReply(page);
    const lower = reply.toLowerCase();
    expect(
      lower.includes('server') ||
        lower.includes('proxy') ||
        lower.includes('backend') ||
        lower.includes('server-side'),
    ).toBeTruthy();
  });

  test('platform mode validation runs without demo footer', async ({ page }) => {
    await page.waitForFunction(() => window.__guidekitTest != null, undefined, { timeout: 20_000 });

    const validationPromise = page.evaluate(() =>
      window.__guidekitTest!.waitForEvent('validation:complete', 45_000),
    );

    await sendChatMessage(page, 'Reply with exactly: Platform check.');
    const reply = await waitForAssistantReply(page);
    expect(reply).not.toContain('[Platform Mode]');
    expect(reply).not.toContain('Response validated by');

    const event = await validationPromise;
    expect(event.name).toBe('validation:complete');
  });

  test('intelligence enriches page context in reply', async ({ page }) => {
    await sendChatMessage(
      page,
      'Name one section on this page that has a contact form. Reply with only the section name.',
    );
    const reply = await waitForAssistantReply(page);
    expect(reply.toLowerCase()).toMatch(/contact/);
  });
});
