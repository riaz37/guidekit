import type { Page } from '@playwright/test';

/** Deterministic Gemini-style SSE stream for contract-tier E2E (no live API key). */
export function geminiToolCallSse(
  name: string,
  args: Record<string, unknown>,
): string {
  const payload = {
    candidates: [
      {
        content: {
          parts: [
            {
              functionCall: {
                name,
                args,
              },
            },
          ],
        },
      },
    ],
  };
  return `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
}

export function geminiHighlightToolSse(sectionId: string): string {
  return geminiToolCallSse('highlight', {
    sectionId,
    tooltip: 'Here is the section',
  });
}

export function geminiScrollToSectionSse(sectionId: string): string {
  return geminiToolCallSse('scrollToSection', { sectionId });
}

/** Mock /api/guidekit/llm; first POST returns tool SSE, later POSTs return text-only STOP. */
export async function mockLlmToolRoute(
  page: Page,
  firstRoundBody: string,
): Promise<void> {
  let calls = 0;
  await page.route('**/api/guidekit/llm', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    calls += 1;
    const body =
      calls === 1
        ? firstRoundBody
        : 'data: {"candidates":[{"content":{"parts":[{"text":"Done."}]},"finishReason":"STOP"}]}\n\ndata: [DONE]\n\n';
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body,
    });
  });
}

/** Mock /api/guidekit/llm with a scrollToSection tool-call response. */
export async function mockLlmScrollRoute(
  page: Page,
  sectionId = 'features',
): Promise<void> {
  await mockLlmToolRoute(page, geminiScrollToSectionSse(sectionId));
}

/** Mock /api/guidekit/llm with a highlight tool-call response. */
export async function mockLlmHighlightRoute(
  page: Page,
  sectionId = 'features',
): Promise<void> {
  await mockLlmToolRoute(page, geminiHighlightToolSse(sectionId));
}

/** Open widget panel and return the text input locator. */
export async function openWidgetInput(page: Page) {
  await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
  const fab = page.locator('.gk-fab');
  await fab.waitFor({ state: 'visible', timeout: 10_000 });
  await fab.click();
  const input = page.locator('.gk-input');
  await input.waitFor({ state: 'visible', timeout: 10_000 });
  return input;
}

export function isElementInViewport(
  box: { y: number; height: number } | null,
  viewportHeight: number,
): boolean {
  if (!box) return false;
  return box.y >= 0 && box.y + box.height <= viewportHeight;
}
