import { test, expect } from '@playwright/test';
import {
  geminiExecuteCustomActionSse,
  mockLlmToolRoute,
  openWidgetInput,
} from '../fixtures/mock-llm-proxy';

test.describe('Custom actions', () => {
  test.beforeEach(async ({ page }) => {
    await mockLlmToolRoute(
      page,
      geminiExecuteCustomActionSse('showAlert', { message: 'E2E custom action' }),
    );
    await page.goto('/');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
  });

  test('executeCustomAction showAlert opens a dialog', async ({ page }) => {
    page.on('dialog', async (dialog) => {
      expect(dialog.message()).toContain('E2E custom action');
      await dialog.accept();
    });

    const input = await openWidgetInput(page);
    await input.fill('Show alert');
    await page.getByTestId('guidekit-send').click();

    await expect(page.locator('.gk-message[data-role="assistant"]').last()).not.toHaveText('', {
      timeout: 20_000,
    });
  });
});
