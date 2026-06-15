import { test, expect } from '@playwright/test';
import { mockLlmScrollRoute, openWidgetInput } from '../fixtures/mock-llm-proxy';

test.describe('Agent form interaction', () => {
  test.beforeEach(async ({ page }) => {
    await mockLlmScrollRoute(page, 'contact');
    await page.goto('/');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
  });

  test('scrollToSection exposes contact form fields', async ({ page }) => {
    const input = await openWidgetInput(page);
    await input.fill('Take me to the contact form');
    await page.getByTestId('guidekit-send').click();

    await expect(page.locator('#contact')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#name')).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
  });
});
