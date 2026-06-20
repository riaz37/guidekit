import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { isElementInViewport, waitForWidgetPanelOpen } from './mock-llm-proxy';

export async function gotoHomeWithWidget(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('#guidekit-widget', { timeout: 20_000 });
}

export async function sendChatMessage(page: Page, text: string): Promise<void> {
  await page.waitForSelector('#guidekit-widget', { timeout: 20_000 });
  const panel = page.locator('.gk-panel[data-open="true"]');
  if (!(await panel.isVisible())) {
    const fab = page.locator('.gk-fab');
    await fab.waitFor({ state: 'visible', timeout: 10_000 });
    await fab.click();
  }

  const input = page.locator('.gk-input');
  await input.waitFor({ state: 'visible', timeout: 10_000 });
  await expect(input).toBeEnabled({ timeout: 60_000 });
  await input.fill(text);
  await input.press('Enter');
}

export async function waitForAssistantReply(
  page: Page,
  options: { timeout?: number; minLength?: number } = {},
): Promise<string> {
  const timeout = options.timeout ?? 45_000;
  const minLength = options.minLength ?? 5;
  const assistant = page.locator('.gk-message[data-role="assistant"]').last();
  await expect(assistant).not.toHaveText('', { timeout });
  const text = (await assistant.textContent())?.trim() ?? '';
  if (/(high demand|unavailable|503)/i.test(text)) {
    test.skip(
      true,
      'Gemini returned a transient 503 (high demand). Retry later, or reduce parallelism/retries.',
    );
  }
  expect(text.length).toBeGreaterThanOrEqual(minLength);
  expect(text.toLowerCase()).not.toContain('error:');
  return text;
}

export async function waitForLlmResponse(page: Page, timeout = 60_000): Promise<void> {
  await page.waitForResponse(
    (res) =>
      res.url().includes('/api/guidekit/llm') &&
      res.request().method() === 'POST' &&
      res.status() === 200,
    { timeout },
  );
}

export async function waitForSectionInViewport(
  page: Page,
  selector: string,
  timeout = 20_000,
): Promise<void> {
  const viewport = page.viewportSize();
  const viewportHeight = viewport?.height ?? 800;
  await page.waitForFunction(
    ([sel, vh]) => {
      const el = document.querySelector(sel);
      if (!el || !vh) return false;
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= vh;
    },
    [selector, viewportHeight] as const,
    { timeout },
  );
  const box = await page.locator(selector).boundingBox();
  expect(isElementInViewport(box, viewportHeight)).toBe(true);
}

export async function waitForSpotlight(page: Page, timeout = 25_000): Promise<void> {
  const spotlight = page.locator('[data-guidekit-spotlight]');
  await expect(spotlight).toBeAttached({ timeout });
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-guidekit-spotlight]');
    return el instanceof HTMLElement && el.style.opacity === '1';
  }, undefined, { timeout });
}

export async function fetchSessionToken(request: APIRequestContext): Promise<string> {
  const tokenRes = await request.post('/api/guidekit/token');
  expect(tokenRes.ok()).toBeTruthy();
  const { token } = (await tokenRes.json()) as { token: string };
  expect(token.length).toBeGreaterThan(20);
  return token;
}

export async function openWidgetInput(page: Page) {
  await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
  const fab = page.locator('.gk-fab');
  await fab.waitFor({ state: 'visible', timeout: 10_000 });
  await fab.click();
  await waitForWidgetPanelOpen(page);
  const input = page.getByTestId('guidekit-input');
  await input.waitFor({ state: 'visible', timeout: 10_000 });
  return input;
}

export function toolOnlyPrompt(
  tool: string,
  argsDescription: string,
): string {
  return `Use the ${tool} tool with ${argsDescription}. Only call the tool.`;
}

export async function waitForGuidekitTestBridge(page: Page, timeout = 20_000): Promise<void> {
  await page.waitForFunction(() => window.__guidekitTest != null, undefined, { timeout });
}

export async function waitForSpotlightDismissed(page: Page, timeout = 35_000): Promise<void> {
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-guidekit-spotlight]');
    if (!el) return true;
    return el instanceof HTMLElement && el.style.opacity === '0';
  }, undefined, { timeout });
}

export async function installClickListener(page: Page, selector: string, flagName: string): Promise<void> {
  await page.evaluate(
    ([sel, flag]) => {
      (window as unknown as Record<string, boolean>)[flag] = false;
      const el = document.querySelector(sel);
      if (el) {
        el.addEventListener('click', () => {
          (window as unknown as Record<string, boolean>)[flag] = true;
        });
      }
    },
    [selector, flagName] as const,
  );
}

export async function wasElementClicked(page: Page, flagName: string): Promise<boolean> {
  return page.evaluate((flag) => Boolean((window as unknown as Record<string, boolean>)[flag]), flagName);
}

export async function invalidateSessionToken(
  request: APIRequestContext,
  token: string,
): Promise<void> {
  const res = await request.post('/api/guidekit/test/invalidate-session', {
    data: { token },
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { ok?: boolean };
  expect(body.ok).toBe(true);
}
