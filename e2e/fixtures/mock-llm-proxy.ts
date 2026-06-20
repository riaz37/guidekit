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

export function geminiTextStopSse(text = 'Done.'): string {
  return `data: {"candidates":[{"content":{"parts":[{"text":${JSON.stringify(text)}}]},"finishReason":"STOP"}]}\n\ndata: [DONE]\n\n`;
}

export function geminiStartTourSse(sectionIds: string[], mode: 'auto' | 'manual' = 'auto'): string {
  return geminiToolCallSse('startTour', { sectionIds, mode });
}

export function geminiClickElementSse(selector: string): string {
  return geminiToolCallSse('clickElement', { selector });
}

export function geminiExecuteCustomActionSse(actionId: string, params: Record<string, unknown>): string {
  return geminiToolCallSse('executeCustomAction', { actionId, params });
}

export function geminiDismissHighlightSse(): string {
  return geminiToolCallSse('dismissHighlight', {});
}

export function geminiReadPageContentSse(sectionId: string): string {
  return geminiToolCallSse('readPageContent', { sectionId });
}

/** Mock /api/guidekit/llm; each POST returns the next tool SSE, then text STOP. */
export async function mockLlmToolSequenceRoute(page: Page, rounds: string[]): Promise<void> {
  let calls = 0;
  await page.route('**/api/guidekit/llm', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    calls += 1;
    const body = calls <= rounds.length ? rounds[calls - 1]! : geminiTextStopSse();
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

/** Wait until the widget panel is fully open (React or vanilla Shadow DOM). */
export async function waitForWidgetPanelOpen(page: Page) {
  await page.waitForFunction(() => {
    const host = document.getElementById('guidekit-widget');
    const root = host?.shadowRoot;
    if (!root) return false;

    const reactPanel = root.querySelector('[data-testid="guidekit-panel"]');
    if (reactPanel) {
      return reactPanel.getAttribute('data-open') === 'true';
    }

    const vanillaPanel = root.querySelector('.gk-panel');
    return vanillaPanel?.classList.contains('gk-open') ?? false;
  }, undefined, { timeout: 15_000 });
}

/** Open widget panel and return the text input locator (React or vanilla). */
export async function openWidgetInput(page: Page) {
  await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
  const fab = page.locator('.gk-fab');
  await fab.waitFor({ state: 'visible', timeout: 10_000 });
  await fab.click({ force: true });
  await waitForWidgetPanelOpen(page);
  const input = page.locator('.gk-input');
  await input.waitFor({ state: 'visible', timeout: 10_000 });
  return input;
}

/** Open the widget, type a message, and send via Enter (avoids flaky send-button hit targets). */
export async function sendWidgetMessage(page: Page, text: string) {
  const input = await openWidgetInput(page);
  await input.fill(text);
  await input.press('Enter');
}

export function isElementInViewport(
  box: { y: number; height: number } | null,
  viewportHeight: number,
): boolean {
  if (!box) return false;
  return box.y >= 0 && box.y + box.height <= viewportHeight;
}
