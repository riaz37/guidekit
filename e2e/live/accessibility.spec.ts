import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { isLiveLlmEnabled, liveSkipReason } from '../env';

test.describe('Live accessibility', () => {
  test.skip(!isLiveLlmEnabled(), liveSkipReason());
  test.describe.configure({ timeout: 60_000, retries: 1 });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
    await page.locator('.gk-fab').waitFor({ state: 'visible', timeout: 10_000 });
  });

  test('main page has zero critical axe violations', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const critical = results.violations.filter((v) => v.impact === 'critical');
    expect(critical).toHaveLength(0);
  });

  test('page with widget open has zero critical axe violations', async ({ page }) => {
    await page.locator('.gk-fab').click();
    await page.locator('.gk-panel[data-open="true"]').waitFor({ state: 'visible', timeout: 5_000 });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const critical = results.violations.filter((v) => v.impact === 'critical');
    expect(critical).toHaveLength(0);
  });

  test('widget FAB has minimum 44x44 touch target', async ({ page }) => {
    const fab = page.locator('.gk-fab');
    const box = await fab.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('all interactive elements in widget are keyboard-reachable', async ({ page }) => {
    await page.locator('.gk-fab').click();
    await page.locator('.gk-panel[data-open="true"]').waitFor({ state: 'visible', timeout: 5_000 });

    const closeBtn = page.locator('.gk-close-btn');
    const input = page.locator('.gk-input');
    const sendBtn = page.locator('.gk-send-btn');

    await expect(closeBtn).toBeVisible();
    await expect(input).toBeVisible();
    await expect(sendBtn).toBeVisible();

    expect(await closeBtn.getAttribute('tabindex')).toBe('0');
    expect(await input.getAttribute('tabindex')).toBe('0');
    expect(await sendBtn.getAttribute('tabindex')).toBe('0');
  });

  test('aria-live region exists in the transcript area', async ({ page }) => {
    await page.locator('.gk-fab').click();
    await page.locator('.gk-panel[data-open="true"]').waitFor({ state: 'visible', timeout: 5_000 });

    const transcript = page.locator('.gk-transcript');
    await expect(transcript).toHaveAttribute('aria-live', 'polite');
    await expect(transcript).toHaveAttribute('role', 'log');
  });
});
