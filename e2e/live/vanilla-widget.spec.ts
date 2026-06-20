import { test, expect } from '@playwright/test';
import { isLiveLlmEnabled, liveSkipReason } from '../env';
import { openWidgetInput } from '../fixtures/live-helpers';

test.describe('Live vanilla IIFE widget', () => {
  test.skip(!isLiveLlmEnabled(), liveSkipReason());
  test.describe.configure({ timeout: 120_000, retries: 2 });

  test('vanilla bundle mounts widget and gets real LLM reply', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const resp = await page.goto('/vanilla-demo.html');
    expect(resp?.ok(), `vanilla-demo.html failed: ${resp?.status()}`).toBe(true);

    const bundleRes = await page.request.get('/vanilla/guidekit-global');
    expect(bundleRes.ok(), `vanilla bundle failed: ${bundleRes.status()}`).toBe(true);

    await page.waitForSelector('#guidekit-widget', { timeout: 20_000 });
    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);

    const input = await openWidgetInput(page);
    await expect(input).toBeEnabled({ timeout: 60_000 });

    const llmResponse = page.waitForResponse(
      (res) =>
        res.url().includes('/api/guidekit/llm') &&
        res.request().method() === 'POST' &&
        res.status() === 200,
      { timeout: 75_000 },
    );

    await input.fill('Say hello in five words or fewer.');
    await input.press('Enter');
    await llmResponse;

    const assistant = page.locator('.gk-msg-assistant, .gk-message[data-role="assistant"]').last();
    await expect(assistant).not.toHaveText('', { timeout: 75_000 });
    const text = (await assistant.textContent())?.trim() ?? '';
    expect(text.length).toBeGreaterThan(3);
    expect(text.toLowerCase()).not.toContain('error:');
  });
});
