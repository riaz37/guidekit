import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },

  use: {
    baseURL: 'http://localhost:3099',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'pnpm --filter @guidekit/example-nextjs dev',
    url: 'http://localhost:3099',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
