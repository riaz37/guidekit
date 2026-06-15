import { test, expect } from '@playwright/test';
import {
  mockLlmScrollRoute,
  mockLlmHighlightRoute,
  openWidgetInput,
  isElementInViewport,
} from '../fixtures/mock-llm-proxy';

/**
 * Agent flow E2E tests — guided navigation, forms, and proxy health.
 */

test.describe('Agent flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
  });

  test('widget loads and accepts text input in proxy mode', async ({ page }) => {
    const input = await openWidgetInput(page);
    await input.fill('Where is the main content?');
    await expect(input).toHaveValue('Where is the main content?');
  });

  test('contract — mock LLM scrollToSection tool scrolls pricing into view', async ({
    page,
  }) => {
    await mockLlmScrollRoute(page, 'pricing');
    const input = await openWidgetInput(page);
    await input.fill('Show me the pricing section');
    await page.locator('.gk-send-btn').click();

    const pricing = page.locator('#pricing');
    await expect(pricing).toBeVisible({ timeout: 15_000 });

    const viewport = page.viewportSize();
    await page.waitForFunction(
      ([selector, vh]) => {
        const el = document.querySelector(selector);
        if (!el || !vh) return false;
        const rect = el.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= vh;
      },
      ['#pricing', viewport?.height ?? 800] as const,
      { timeout: 15_000 },
    );

    const box = await pricing.boundingBox();
    expect(isElementInViewport(box, viewport?.height ?? 800)).toBe(true);
  });

  test('contract — mock LLM highlight tool shows spotlight overlay', async ({ page }) => {
    await mockLlmHighlightRoute(page, 'hero');
    const input = await openWidgetInput(page);
    const llmResponse = page.waitForResponse(
      (res) =>
        res.url().includes('/api/guidekit/llm') &&
        res.request().method() === 'POST' &&
        res.status() === 200,
    );
    await input.fill('Show me the hero section');
    await page.locator('.gk-send-btn').click();
    await llmResponse;

    const spotlight = page.locator('[data-guidekit-spotlight]');
    await expect(spotlight).toBeAttached({ timeout: 20_000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-guidekit-spotlight]');
      return el instanceof HTMLElement && el.style.opacity === '1';
    }, undefined, { timeout: 20_000 });
  });

  test('form help — contact form fields are discoverable', async ({ page }) => {
    const form = page.locator('#contact form');
    await expect(form).toBeVisible();
    await expect(page.locator('#name')).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#message')).toBeVisible();

    const input = await openWidgetInput(page);
    await input.fill('Help me fill out the contact form');
    await expect(input).toHaveValue('Help me fill out the contact form');
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

  test('stt and tts routes reject GET', async ({ request }) => {
    const stt = await request.get('/api/guidekit/stt');
    expect(stt.status()).toBe(405);
    const tts = await request.get('/api/guidekit/tts');
    expect(tts.status()).toBe(405);
  });

  test('token endpoint rejects GET', async ({ request }) => {
    const res = await request.get('/api/guidekit/token');
    expect(res.status()).toBe(405);
  });
});
