import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
    // Wait for the FAB to be visible before running accessibility checks
    await page.locator('.gk-fab').waitFor({ state: 'visible', timeout: 10_000 });
  });

  test('main page has zero critical axe violations', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const critical = results.violations.filter(
      (v) => v.impact === 'critical',
    );

    if (critical.length > 0) {
      console.log('Critical violations:', JSON.stringify(critical, null, 2));
    }

    expect(critical).toHaveLength(0);
  });

  test('page with widget open has zero critical axe violations', async ({ page }) => {
    // Open the widget panel
    const fab = page.locator('.gk-fab');
    await fab.click();
    await page.locator('.gk-panel[data-open="true"]').waitFor({ state: 'visible', timeout: 5_000 });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const critical = results.violations.filter(
      (v) => v.impact === 'critical',
    );

    if (critical.length > 0) {
      console.log('Critical violations with widget open:', JSON.stringify(critical, null, 2));
    }

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
    // Open the widget
    const fab = page.locator('.gk-fab');
    await fab.click();
    await page.locator('.gk-panel[data-open="true"]').waitFor({ state: 'visible', timeout: 5_000 });

    // Tab from the FAB — we should be able to reach the close button, input, and send button
    // The close button, input, and send button should all be tabbable
    const closeBtn = page.locator('.gk-close-btn');
    const input = page.locator('.gk-input');
    const sendBtn = page.locator('.gk-send-btn');

    // Verify these elements exist and have non-negative tabindex when panel is open
    await expect(closeBtn).toBeVisible();
    await expect(input).toBeVisible();
    await expect(sendBtn).toBeVisible();

    // Check that tabindex is 0 (reachable) when panel is open
    const closeBtnTabindex = await closeBtn.getAttribute('tabindex');
    const inputTabindex = await input.getAttribute('tabindex');
    const sendBtnTabindex = await sendBtn.getAttribute('tabindex');

    expect(closeBtnTabindex).toBe('0');
    expect(inputTabindex).toBe('0');
    expect(sendBtnTabindex).toBe('0');
  });

  test('widget panel has proper focus management', async ({ page }) => {
    // Open the widget
    const fab = page.locator('.gk-fab');
    await fab.click();

    const input = page.locator('.gk-input');
    await input.waitFor({ state: 'visible', timeout: 5_000 });

    // The input starts disabled until the SDK initialises. In CI there is no
    // LLM configured so it may stay disabled. Verify focus only when enabled;
    // otherwise confirm accessibility attributes are set correctly.
    const isDisabled = await input.isDisabled();
    if (!isDisabled) {
      await input.focus();
      await expect(input).toBeFocused();
    } else {
      // Focus should land on the shadow host or an enabled element
      // Verify the input has correct a11y attributes for when it becomes enabled
      await expect(input).toHaveAttribute('tabindex', '0');
      await expect(input).toHaveAttribute('aria-label', 'Send message');
    }
  });

  test('aria-live region exists in the transcript area', async ({ page }) => {
    // Open the widget
    const fab = page.locator('.gk-fab');
    await fab.click();
    await page.locator('.gk-panel[data-open="true"]').waitFor({ state: 'visible', timeout: 5_000 });

    // The transcript area should have aria-live="polite" for screen reader updates
    const transcript = page.locator('.gk-transcript');
    await expect(transcript).toHaveAttribute('aria-live', 'polite');
    await expect(transcript).toHaveAttribute('role', 'log');
  });
});
