import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helper: locate elements inside the GuideKit widget's Shadow DOM
// ---------------------------------------------------------------------------

/**
 * The GuideKit widget renders inside a Shadow DOM host (#guidekit-widget).
 * Playwright's locators can pierce Shadow DOM by default when using
 * `page.locator()`, but we create helpers for clarity.
 */

test.describe('Widget UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the widget host element to appear in the DOM
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
  });

  test('FAB button is visible on page load', async ({ page }) => {
    const fab = page.locator('.gk-fab');
    await expect(fab).toBeVisible({ timeout: 10_000 });
  });

  test('clicking FAB opens the chat panel', async ({ page }) => {
    const fab = page.locator('.gk-fab');
    await fab.click();

    const panel = page.locator('.gk-panel[data-open="true"]');
    await expect(panel).toBeVisible({ timeout: 5_000 });
  });

  test('panel has input field and send button', async ({ page }) => {
    const fab = page.locator('.gk-fab');
    await fab.click();

    const input = page.locator('.gk-input');
    await expect(input).toBeVisible({ timeout: 5_000 });

    const sendBtn = page.locator('.gk-send-btn');
    await expect(sendBtn).toBeVisible();
  });

  test('Escape key closes the panel', async ({ page }) => {
    const fab = page.locator('.gk-fab');
    await fab.click();

    const panel = page.locator('.gk-panel[data-open="true"]');
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // Dispatch a KeyboardEvent directly on the panel element inside Shadow DOM.
    // page.keyboard.press doesn't reliably reach Shadow DOM React handlers.
    await panel.evaluate((el) => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    // Verify the FAB reflects the closed state
    await expect(fab).toHaveAttribute('aria-expanded', 'false', { timeout: 5_000 });
  });

  test('FAB shows aria-expanded attribute correctly', async ({ page }) => {
    const fab = page.locator('.gk-fab');

    // Initially not expanded
    await expect(fab).toHaveAttribute('aria-expanded', 'false');

    // Click to open
    await fab.click();
    await expect(fab).toHaveAttribute('aria-expanded', 'true');

    // Click to close
    await fab.click();
    await expect(fab).toHaveAttribute('aria-expanded', 'false');
  });

  test('panel has role="dialog" and aria-label', async ({ page }) => {
    const panel = page.locator('.gk-panel');

    await expect(panel).toHaveAttribute('role', 'dialog');
    // The aria-label is set via i18n key 'widgetTitle'
    const ariaLabel = await panel.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
  });

  test('input field is focusable after panel opens', async ({ page }) => {
    const fab = page.locator('.gk-fab');
    await fab.click();

    const input = page.locator('.gk-input');
    await expect(input).toBeVisible({ timeout: 5_000 });

    // The input starts disabled until the SDK initialises. In CI there is no
    // LLM configured so it may stay disabled. Wait briefly, then check: if
    // the input is enabled we verify focus; otherwise we just confirm the
    // element is present and has the correct tabindex for when it becomes enabled.
    const isDisabled = await input.isDisabled();
    if (!isDisabled) {
      await input.focus();
      await expect(input).toBeFocused();
    } else {
      // Still verify accessibility attributes are correct
      await expect(input).toHaveAttribute('tabindex', '0');
      await expect(input).toHaveAttribute('aria-label', 'Send message');
    }
  });
});
