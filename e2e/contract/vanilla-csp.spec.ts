import { test, expect } from '@playwright/test';
import { mockLlmTextRoute } from '../fixtures/voice-mocks';

test.describe('Vanilla CSP embed', () => {
  test('widget mounts under strict CSP', async ({ page }) => {
    await mockLlmTextRoute(page, 'CSP demo ready.');
    await page.goto('/vanilla-csp-demo.html');
    await page.waitForSelector('#guidekit-widget', { timeout: 20_000 });
    await page.locator('#guidekit-widget').click();
    await expect(page.locator('.gk-panel.gk-open, [data-open="true"]')).toBeVisible({ timeout: 10_000 });
  });
});
