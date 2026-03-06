import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Test-App SDK Debug Panel — E2E Tests
//
// These tests verify that the SDK debug panel and all GuideKit hooks
// work correctly in a real browser environment.
// ---------------------------------------------------------------------------

test.describe('Test-App: Page Rendering', () => {
  test('FlowBoard landing page renders (not blank)', async ({ page }) => {
    await page.goto('/');
    // The page should have visible content — not an empty shell
    const heading = page.locator('h1');
    await expect(heading).toBeVisible({ timeout: 10_000 });
    await expect(heading).toContainText('Project management');
  });

  test('all 6 sections with data-guidekit-target are present', async ({ page }) => {
    await page.goto('/');
    const targets = page.locator('[data-guidekit-target]');
    await expect(targets).toHaveCount(6, { timeout: 10_000 });
  });
});

test.describe('Test-App: GuideKit Widget', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#guidekit-widget', { timeout: 15_000 });
  });

  test('widget host has ARIA attributes (ADR-003)', async ({ page }) => {
    const host = page.locator('#guidekit-widget');
    await expect(host).toHaveAttribute('role', 'complementary');
    const label = await host.getAttribute('aria-label');
    expect(label).toBeTruthy();
  });

  test('FAB button is visible', async ({ page }) => {
    const fab = page.locator('.gk-fab');
    await expect(fab).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Test-App: SDK Debug Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the page to hydrate and the debug panel toggle to appear
    await page.waitForSelector('button:has-text("SDK Debug")', { timeout: 15_000 });
  });

  test('toggle button is visible on left edge', async ({ page }) => {
    const toggle = page.locator('button:has-text("SDK Debug")');
    await expect(toggle).toBeVisible();
    const box = await toggle.boundingBox();
    expect(box).not.toBeNull();
    // Should be on the left edge
    expect(box!.x).toBeLessThan(50);
  });

  test('clicking toggle opens the panel', async ({ page }) => {
    await page.click('button:has-text("SDK Debug")');
    // Panel should appear with tab bar containing Status button
    const statusTab = page.getByRole('button', { name: 'Status' });
    await expect(statusTab).toBeVisible({ timeout: 5_000 });
  });

  test('toggle text changes to Close when open', async ({ page }) => {
    await page.click('button:has-text("SDK Debug")');
    const closeBtn = page.locator('button:has-text("Close")');
    await expect(closeBtn).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Test-App: Status Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('button:has-text("SDK Debug")', { timeout: 15_000 });
    await page.click('button:has-text("SDK Debug")');
    await page.click('button:has-text("Status")');
  });

  test('shows ready indicator once SDK initializes', async ({ page }) => {
    // Should eventually show "Ready" text
    const ready = page.locator('text=Ready');
    await expect(ready).toBeVisible({ timeout: 15_000 });
  });

  test('shows agent state badge', async ({ page }) => {
    // Should show a state like "idle"
    const badge = page.locator('text=idle');
    await expect(badge).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Test-App: Voice Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('button:has-text("SDK Debug")', { timeout: 15_000 });
    await page.click('button:has-text("SDK Debug")');
    await page.click('button:has-text("Voice")');
  });

  test('shows listening and speaking indicators', async ({ page }) => {
    await expect(page.locator('text=Listening:')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Speaking:')).toBeVisible();
  });

  test('has Start Listening button', async ({ page }) => {
    const btn = page.locator('button:has-text("Start Listening")');
    await expect(btn).toBeVisible({ timeout: 5_000 });
  });

  test('has text input and Send button', async ({ page }) => {
    const input = page.locator('input[placeholder="Type a message..."]');
    await expect(input).toBeVisible({ timeout: 5_000 });
    const sendBtn = page.locator('button:has-text("Send")');
    await expect(sendBtn).toBeVisible();
  });

  test('Send button is disabled when input is empty', async ({ page }) => {
    const sendBtn = page.locator('button:has-text("Send")');
    await expect(sendBtn).toBeDisabled();
  });
});

test.describe('Test-App: Stream Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('button:has-text("SDK Debug")', { timeout: 15_000 });
    await page.click('button:has-text("SDK Debug")');
    await page.click('button:has-text("Stream")');
  });

  test('shows streaming indicator', async ({ page }) => {
    await expect(page.locator('text=Streaming:')).toBeVisible({ timeout: 5_000 });
  });

  test('has text input and Stream button', async ({ page }) => {
    const input = page.locator('input[placeholder="Type a message to stream..."]');
    await expect(input).toBeVisible({ timeout: 5_000 });
    // The "Stream" submit button inside the panel (not the tab)
    const btn = page.getByRole('button', { name: 'Stream' }).nth(1);
    await expect(btn).toBeVisible();
  });
});

test.describe('Test-App: Actions Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('button:has-text("SDK Debug")', { timeout: 15_000 });
    await page.click('button:has-text("SDK Debug")');
    await page.click('button:has-text("Actions")');
  });

  test('has section selector dropdown', async ({ page }) => {
    const select = page.locator('select');
    await expect(select).toBeVisible({ timeout: 5_000 });
    // Should have 6 options
    const options = select.locator('option');
    await expect(options).toHaveCount(6);
  });

  test('has Highlight, Dismiss, and Scroll buttons', async ({ page }) => {
    await expect(page.locator('button:has-text("Highlight")')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('button:has-text("Dismiss")')).toBeVisible();
    await expect(page.locator('button:has-text("Scroll")')).toBeVisible();
  });

  test('has tour section checkboxes', async ({ page }) => {
    const checkboxes = page.locator('input[type="checkbox"]');
    await expect(checkboxes.first()).toBeVisible({ timeout: 5_000 });
    const count = await checkboxes.count();
    expect(count).toBe(6);
  });

  test('has Start Tour button', async ({ page }) => {
    await expect(page.locator('button:has-text("Start Tour")')).toBeVisible({ timeout: 5_000 });
  });

  test('has navigate input and Go button', async ({ page }) => {
    const navInput = page.locator('input[placeholder="#section or /path"]');
    await expect(navInput).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('button:has-text("Go")')).toBeVisible();
  });

  test('navigate scrolls to FAQ section', async ({ page }) => {
    // Default value is #faq
    await page.click('button:has-text("Go")');
    // Wait a bit for smooth scroll
    await page.waitForTimeout(500);
    // FAQ section should be near viewport
    const faq = page.locator('#faq');
    await expect(faq).toBeInViewport({ timeout: 5_000 });
  });
});

test.describe('Test-App: Context Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('button:has-text("SDK Debug")', { timeout: 15_000 });
    await page.click('button:has-text("SDK Debug")');
    await page.click('button:has-text("Context")');
  });

  test('has JSON context textarea and Set Context button', async ({ page }) => {
    const textarea = page.locator('.space-y-4 textarea').first();
    await expect(textarea).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('button:has-text("Set Context")')).toBeVisible();
  });

  test('has key/value inputs and Add button', async ({ page }) => {
    const keyInput = page.locator('input[placeholder="key"]');
    await expect(keyInput).toBeVisible({ timeout: 5_000 });
    const valueInput = page.locator('input[placeholder="value"]');
    await expect(valueInput).toBeVisible();
    await expect(page.locator('button:has-text("Add")')).toBeVisible();
  });

  test('has Register action buttons', async ({ page }) => {
    await expect(page.locator('button:has-text("Register book-demo")')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('button:has-text("Register compare-plans")')).toBeVisible();
  });

  test('registering action disables the button', async ({ page }) => {
    const btn = page.locator('button:has-text("Register book-demo")');
    await btn.click();
    // Button text should change to indicate registered
    await expect(page.locator('button:has-text("book-demo registered")')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('button:has-text("book-demo registered")')).toBeDisabled();
  });
});

test.describe('Test-App: Health Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('button:has-text("SDK Debug")', { timeout: 15_000 });
    await page.click('button:has-text("SDK Debug")');
    await page.click('button:has-text("Health")');
  });

  test('has Run Health Check button', async ({ page }) => {
    await expect(page.locator('button:has-text("Run Health Check")')).toBeVisible({ timeout: 5_000 });
  });

  test('running health check shows subsystem badges', async ({ page }) => {
    // Wait for SDK to be ready first
    await page.click('button:has-text("Status")');
    await page.locator('text=Ready').waitFor({ timeout: 15_000 });
    await page.click('button:has-text("Health")');

    await page.click('button:has-text("Run Health Check")');
    // Should show Overall status and subsystem badges
    await expect(page.locator('text=Overall:')).toBeVisible({ timeout: 10_000 });
    // At least one subsystem badge should appear (LLM, STT, TTS, MIC)
    await expect(page.locator('text=LLM')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=STT')).toBeVisible();
    await expect(page.locator('text=TTS')).toBeVisible();
    await expect(page.locator('text=MIC')).toBeVisible();
  });
});

test.describe('Test-App: Events Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('button:has-text("SDK Debug")', { timeout: 15_000 });
    await page.click('button:has-text("SDK Debug")');
  });

  test('shows Event Log heading', async ({ page }) => {
    await page.click('button:has-text("Events")');
    await expect(page.locator('text=Event Log')).toBeVisible({ timeout: 5_000 });
  });

  test('logs "GuideKit is ready" event after initialization', async ({ page }) => {
    // Wait for SDK to initialize
    await page.click('button:has-text("Status")');
    await page.locator('text=Ready').waitFor({ timeout: 15_000 });

    // Switch to Events tab
    await page.click('button:has-text("Events")');
    await expect(page.locator('text=GuideKit is ready')).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Test-App: Tab Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('button:has-text("SDK Debug")', { timeout: 15_000 });
    await page.click('button:has-text("SDK Debug")');
  });

  test('all 10 tabs are present', async ({ page }) => {
    for (const tab of ['Status', 'Voice', 'Stream', 'Actions', 'Context', 'Health', 'Intel', 'Plugins', 'Knowledge', 'Events']) {
      await expect(page.locator(`button:has-text("${tab}")`).first()).toBeVisible({ timeout: 5_000 });
    }
  });

  test('switching tabs changes panel content', async ({ page }) => {
    // Start on Status
    await expect(page.locator('text=Agent State:')).toBeVisible({ timeout: 5_000 });

    // Switch to Actions
    await page.click('button:has-text("Actions")');
    await expect(page.locator('text=Target Section')).toBeVisible({ timeout: 5_000 });

    // Switch to Context
    await page.click('button:has-text("Context")');
    await expect(page.locator('text=Set Page Context')).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Test-App: Intelligence Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('button:has-text("SDK Debug")', { timeout: 15_000 });
    await page.click('button:has-text("SDK Debug")');
    await page.click('button:has-text("Intel")');
  });

  test('has Run Scan button', async ({ page }) => {
    await expect(page.locator('button:has-text("Run Scan")')).toBeVisible({ timeout: 5_000 });
  });

  test('scanning produces results', async ({ page }) => {
    await page.click('button:has-text("Run Scan")');
    // Should show scan results with Components and Headings sections
    await expect(page.locator('text=Components')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Headings')).toBeVisible();
  });

  test('has Hallucination Guard section', async ({ page }) => {
    await expect(page.locator('text=Hallucination Guard')).toBeVisible({ timeout: 5_000 });
  });

  test('has hallucination check textarea and button', async ({ page }) => {
    const textarea = page.locator('textarea[placeholder="Enter LLM response text to validate..."]');
    await expect(textarea).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('button:has-text("Run Hallucination Check")')).toBeVisible();
  });

  test('running hallucination check shows result', async ({ page }) => {
    await page.click('button:has-text("Run Hallucination Check")');
    // Should show Valid or Invalid result with Confidence
    await expect(page.locator('text=Confidence').first()).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Test-App: Plugins Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('button:has-text("SDK Debug")', { timeout: 15_000 });
    await page.click('button:has-text("SDK Debug")');
    await page.click('button:has-text("Plugins")');
  });

  test('has Create & Install Plugin button', async ({ page }) => {
    await expect(page.locator('button:has-text("Create & Install Plugin")')).toBeVisible({ timeout: 5_000 });
  });

  test('installing plugin shows plugin info', async ({ page }) => {
    await page.click('button:has-text("Create & Install Plugin")');
    // Should show the installed plugin name and version
    await expect(page.locator('text=test-analytics').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=v1.0.0').first()).toBeVisible();
  });

  test('installing plugin shows tool and context provider counts', async ({ page }) => {
    await page.click('button:has-text("Create & Install Plugin")');
    // Should show tool count and context providers
    await expect(page.locator('text=Tools:').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Context providers:').first()).toBeVisible();
  });

  test('has Middleware Demo section with Execute Hook button', async ({ page }) => {
    await expect(page.locator('text=Middleware Demo')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('button:has-text("Execute Hook")')).toBeVisible();
  });

  test('Destroy button appears after installing plugin', async ({ page }) => {
    await page.click('button:has-text("Create & Install Plugin")');
    await expect(page.locator('button:has-text("Destroy")')).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Test-App: Knowledge Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('button:has-text("SDK Debug")', { timeout: 15_000 });
    await page.click('button:has-text("SDK Debug")');
    await page.click('button:has-text("Knowledge")');
  });

  test('has Load Samples button', async ({ page }) => {
    await expect(page.locator('button:has-text("Load Samples")')).toBeVisible({ timeout: 5_000 });
  });

  test('has search input', async ({ page }) => {
    const searchInput = page.locator('input[placeholder="Search query..."]');
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
  });

  test('loading samples updates stats', async ({ page }) => {
    await page.click('button:has-text("Load Samples")');
    // Stats should show non-zero document and chunk counts
    await expect(page.locator('text=Documents:')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Chunks:')).toBeVisible();
    // Button should change to "Loaded" and be disabled
    await expect(page.locator('button:has-text("Loaded")')).toBeVisible();
    await expect(page.locator('button:has-text("Loaded")')).toBeDisabled();
  });

  test('searching after loading samples produces results', async ({ page }) => {
    // Load sample documents
    await page.click('button:has-text("Load Samples")');
    await expect(page.locator('button:has-text("Loaded")')).toBeVisible({ timeout: 5_000 });

    // Search with the default query ("keyboard shortcuts")
    await page.click('button:has-text("Search")');
    // Should show results with source titles and scores
    await expect(page.locator('text=FlowBoard').first()).toBeVisible({ timeout: 5_000 });
  });

  test('has engine toggle button', async ({ page }) => {
    await expect(page.locator('button:has-text("Engine:")')).toBeVisible({ timeout: 5_000 });
  });

  test('has Add Document section', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Add Document' })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('input[placeholder="Document title..."]')).toBeVisible();
    await expect(page.locator('textarea[placeholder="Document content..."]')).toBeVisible();
    await expect(page.locator('button:has-text("Add Document")')).toBeVisible();
  });

  test('Clear button resets store', async ({ page }) => {
    // Load samples first
    await page.click('button:has-text("Load Samples")');
    await expect(page.locator('button:has-text("Loaded")')).toBeVisible({ timeout: 5_000 });

    // Clear
    await page.click('button:has-text("Clear")');
    // Load Samples button should reappear (not disabled)
    await expect(page.locator('button:has-text("Load Samples")')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('button:has-text("Load Samples")')).toBeEnabled();
  });
});
