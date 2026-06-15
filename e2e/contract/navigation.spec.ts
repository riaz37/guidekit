import { test, expect } from '@playwright/test';

test.describe('Page Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
  });

  test('DOM scanner finds sections with data-guidekit-target on the page', async ({ page }) => {
    // Verify that elements with data-guidekit-target attribute exist in the DOM
    const targets = page.locator('[data-guidekit-target]');
    const count = await targets.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Verify specific targets exist
    await expect(page.locator('[data-guidekit-target="hero"]')).toBeVisible();
    await expect(page.locator('[data-guidekit-target="features"]')).toBeVisible();
    await expect(page.locator('[data-guidekit-target="contact"]')).toBeVisible();
    await expect(page.locator('[data-guidekit-target="pricing"]')).toBeVisible();
  });

  test('navigating between pages works', async ({ page }) => {
    // Click the About link in the navigation
    await page.click('a[href="/about"]');

    // Verify URL changed
    await expect(page).toHaveURL('/about');

    // Verify about page content is rendered
    await expect(page.locator('h1')).toContainText('About GuideKit');

    // Navigate back to home
    await page.click('a[href="/"]');
    await expect(page).toHaveURL('/');
    await expect(page.locator('h1')).toContainText('GuideKit E2E Test Page');
  });

  test('widget persists across page navigation', async ({ page }) => {
    // Widget should be visible on home page
    const widgetHost = page.locator('#guidekit-widget');
    await expect(widgetHost).toBeVisible({ timeout: 10_000 });

    const fab = page.locator('.gk-fab');
    await expect(fab).toBeVisible({ timeout: 10_000 });

    // Navigate to about page
    await page.click('a[href="/about"]');
    await expect(page).toHaveURL('/about');

    // Widget should still be present on about page
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
    await expect(page.locator('.gk-fab')).toBeVisible({ timeout: 10_000 });
  });
});
