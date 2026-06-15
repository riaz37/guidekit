import { test, expect } from '@playwright/test';
import { geminiTextStopSse, openWidgetInput } from '../fixtures/mock-llm-proxy';

declare global {
  interface Window {
    __guidekitTest?: {
      waitForReady: (timeoutMs?: number) => Promise<void>;
      addKnowledgeDocument: (doc: { id: string; title: string; content: string }) => void;
      removeKnowledgeDocument: (documentId: string) => void;
    };
  }
}

test.describe('Runtime knowledge API', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
  });

  test('addKnowledgeDocument influences LLM systemPrompt; removeKnowledgeDocument removes it', async ({
    page,
  }) => {
    const docId = 'runtime-doc-1';
    const docTitle = 'RuntimeKnowledgeDocTitle_123';
    const uniquePhrase = 'RUNTIME_KNOWLEDGE_PHRASE_XYZZY_123';

    await page.waitForFunction(() => Boolean(window.__guidekitTest), undefined, { timeout: 15_000 });
    await page.evaluate(() => window.__guidekitTest!.waitForReady(30_000));
    await page.evaluate(
      ({ docId, docTitle, uniquePhrase }) => {
        window.__guidekitTest!.addKnowledgeDocument({
          id: docId,
          title: docTitle,
          content: `This doc contains a unique phrase: ${uniquePhrase}`,
        });
      },
      { docId, docTitle, uniquePhrase },
    );

    let seenSystemPrompt = '';
    await page.route('**/api/guidekit/llm', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      const body = route.request().postDataJSON() as { systemPrompt?: string };
      seenSystemPrompt = body.systemPrompt ?? '';
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        body: geminiTextStopSse('OK'),
      });
    });

    const input = await openWidgetInput(page);
    await input.fill(`What do you know about ${uniquePhrase}? Reply in one sentence.`);
    await page.getByTestId('guidekit-send').click();

    await expect.poll(() => seenSystemPrompt, { timeout: 15_000 }).toContain(docTitle);

    await page.unroute('**/api/guidekit/llm');

    await page.evaluate((docId) => window.__guidekitTest!.removeKnowledgeDocument(docId), docId);

    let seenSystemPromptAfterRemove = '';
    await page.route('**/api/guidekit/llm', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      const body = route.request().postDataJSON() as { systemPrompt?: string };
      seenSystemPromptAfterRemove = body.systemPrompt ?? '';
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        body: geminiTextStopSse('OK'),
      });
    });

    await input.fill(`What do you know about ${uniquePhrase}? Reply in one sentence.`);
    await page.getByTestId('guidekit-send').click();

    await expect
      .poll(() => seenSystemPromptAfterRemove, { timeout: 15_000 })
      .not.toContain(docTitle);
  });
});

