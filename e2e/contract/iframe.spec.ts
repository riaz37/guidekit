import { test, expect } from '@playwright/test';

test.describe('Iframe grounding', () => {
  test('cross-origin iframes appear in scan metadata', async ({ page }) => {
    await page.goto('/iframe-test');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
    await page.waitForFunction(() => window.__guidekitTest != null, undefined, { timeout: 20_000 });

    await page.waitForFunction(
      () => {
        const model = window.__guidekitTest?.getPageModel() as {
          scanMetadata?: { crossOriginIframes?: unknown[] };
        } | null;
        const frames = model?.scanMetadata?.crossOriginIframes;
        return Array.isArray(frames) && frames.length > 0;
      },
      undefined,
      { timeout: 20_000 },
    );

    const crossOriginCount = await page.evaluate(() => {
      const model = window.__guidekitTest!.getPageModel() as {
        scanMetadata?: { crossOriginIframes?: unknown[] };
      } | null;
      return model?.scanMetadata?.crossOriginIframes?.length ?? 0;
    });
    expect(crossOriginCount).toBeGreaterThan(0);
  });

  test('same-origin iframe contributes sections', async ({ page }) => {
    await page.goto('/iframe-test');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const model = window.__guidekitTest?.getPageModel() as {
              sections?: Array<{ label: string }>;
            } | null;
            return (
              model?.sections?.some((s) =>
                /same origin|plain|introduction/i.test(s.label),
              ) ?? false
            );
          }),
        { timeout: 20_000 },
      )
      .toBe(true);
  });
});
