import { test, expect } from '@playwright/test';
import { mockLlmScrollRoute } from '../fixtures/mock-llm-proxy';

test.describe('@guidekit/vanilla IIFE', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).module = (window as any).module ?? { exports: {} };
      (window as any).module$1 = (window as any).module$1 ?? (window as any).module;
    });
    await mockLlmScrollRoute(page, 'features');
  });

  test('vanilla bundle mounts widget and opens panel', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const resp = await page.goto('/vanilla-demo.html');
    expect(resp?.ok(), `vanilla-demo.html failed: ${resp?.status()}`).toBe(true);

    const bundleRes = await page.request.get('/vanilla/guidekit-global');
    expect(bundleRes.ok(), `vanilla bundle failed: ${bundleRes.status()}`).toBe(true);

    // Ensure the bundle is loaded even if the HTML page changes.
    await page.addScriptTag({ url: '/vanilla/guidekit-global' });
    await page.waitForTimeout(1000);
    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
    const hasGlobal = await page.evaluate(() => Boolean((window as any).GuideKit));
    expect(hasGlobal, 'GuideKit global not found after loading IIFE bundle').toBe(true);

    // Ensure init ran (the page has its own init script, but this makes the test resilient).
    await page.evaluate(() => {
      if (!document.querySelector('#guidekit-widget')) {
        (window as any).GuideKit.init({
          tokenEndpoint: '/api/guidekit/token',
          proxy: {
            llm: '/api/guidekit/llm',
            health: '/api/guidekit/health',
            stt: '/api/guidekit/stt',
            tts: '/api/guidekit/tts',
          },
          llm: { provider: 'gemini', model: 'gemini-2.5-flash-lite' },
          intelligence: false,
          agent: { name: 'GuideKit Assistant', greeting: 'Hello!' },
          options: { debug: true, mode: 'text' },
        });
      }
    });

    // Vanilla widget uses the same host id + CSS classes.
    await page.waitForSelector('#guidekit-widget', { timeout: 20_000 });
    const fab = page.locator('.gk-fab');
    await expect(fab).toBeVisible();

    await fab.click();
    await expect(page.locator('.gk-panel.gk-open, [data-testid="guidekit-panel"][data-open="true"]')).toBeVisible({ timeout: 10_000 });
  });
});

