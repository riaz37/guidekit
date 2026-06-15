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

  test('platform-demo plugin appends validation footer', async ({ page }) => {
    await sendChatMessage(page, 'Reply with exactly: Platform check.');
    const reply = await waitForAssistantReply(page);
    expect(reply).toContain('[Platform Mode]');
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
