import { test, expect } from '@playwright/test';
import { isLiveLlmEnabled, liveSkipReason } from '../env';
import {
  gotoHomeWithWidget,
  sendChatMessage,
  waitForAssistantReply,
  waitForSectionInViewport,
  waitForSpotlight,
} from '../fixtures/live-helpers';

/**
 * Live agent tool execution — real LLM must invoke scrollToSection / highlight.
 * Run: pnpm test:e2e:live
 */
test.describe('Live agent tools', () => {
  test.skip(!isLiveLlmEnabled(), liveSkipReason());
  test.describe.configure({ timeout: 120_000, retries: 2 });

  test.beforeEach(async ({ page }) => {
    await gotoHomeWithWidget(page);
  });

  test('scrollToSection scrolls pricing into view', async ({ page }) => {
    await sendChatMessage(
      page,
      'Use the scrollToSection tool with sectionId "pricing". Do not reply with text — only call the tool.',
    );
    await waitForSectionInViewport(page, '#pricing');
    await waitForAssistantReply(page, { timeout: 60_000, minLength: 1 }).catch(() => {
      // Tool-only rounds may produce a short follow-up after scrolling.
    });
  });

  test('highlight shows spotlight on hero section', async ({ page }) => {
    await sendChatMessage(
      page,
      'Use the highlight tool with sectionId "hero" and tooltip "Hero section". Only use the tool.',
    );
    await waitForSpotlight(page);
  });

  test('navigate tool opens about page', async ({ page }) => {
    await sendChatMessage(
      page,
      'Use the navigate tool to go to /about. Only call the tool, do not describe the page.',
    );
    await page.waitForURL('**/about', { timeout: 60_000 });
    await page.waitForSelector('h1', { timeout: 15_000 });
    const heading = await page.locator('h1').textContent();
    expect(heading?.toLowerCase()).toContain('about');
  });
});
