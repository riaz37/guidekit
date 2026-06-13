import { test, expect } from '@playwright/test';

/**
 * Agent flow E2E tests — guided navigation, forms, and proxy health.
 */

test.describe('Agent flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
  });

  test('widget loads and accepts text input in proxy mode', async ({ page }) => {
    const widget = page
      .locator('[data-guidekit-widget], guidekit-widget, .guidekit-widget')
      .first();
    const count = await widget.count();
    if (count === 0) {
      test.skip();
      return;
    }

    await widget.click();
    const input = page.locator('textarea, input[type="text"]').last();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill('Where is the main content?');
    await input.press('Enter');
    await page.waitForTimeout(3000);
  });

  test('guided navigation — scroll to features section', async ({ page }) => {
    const features = page.locator('#features');
    await expect(features).toBeVisible();

    const widget = page
      .locator('[data-guidekit-widget], guidekit-widget, .guidekit-widget')
      .first();
    if ((await widget.count()) === 0) {
      test.skip();
      return;
    }

    await widget.click();
    const input = page.locator('textarea, input[type="text"]').last();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill('Show me the features section');
    await input.press('Enter');
    await page.waitForTimeout(2000);

    const box = await features.boundingBox();
    expect(box).not.toBeNull();
  });

  test('form help — contact form fields are discoverable', async ({ page }) => {
    const form = page.locator('#contact form');
    await expect(form).toBeVisible();
    await expect(page.locator('#name')).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#message')).toBeVisible();

    const widget = page
      .locator('[data-guidekit-widget], guidekit-widget, .guidekit-widget')
      .first();
    if ((await widget.count()) === 0) {
      test.skip();
      return;
    }

    await widget.click();
    const input = page.locator('textarea, input[type="text"]').last();
    await input.fill('Help me fill out the contact form');
    await input.press('Enter');
    await page.waitForTimeout(2000);
  });

  test('error recovery — health endpoint after bad token request', async ({ request }) => {
    const health = await request.get('/api/guidekit/health');
    expect(health.ok()).toBeTruthy();
    const body = await health.json();
    expect(body).toHaveProperty('status', 'ok');

    const tokenGet = await request.get('/api/guidekit/token');
    expect(tokenGet.status()).toBe(405);

    const healthAfter = await request.get('/api/guidekit/health');
    expect(healthAfter.ok()).toBeTruthy();
  });

  test('health endpoint responds', async ({ request }) => {
    const res = await request.get('/api/guidekit/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('status', 'ok');
  });

  test('token endpoint rejects GET', async ({ request }) => {
    const res = await request.get('/api/guidekit/token');
    expect(res.status()).toBe(405);
  });
});
