/**
 * Playwright E2E for the example-nextjs app.
 *
 * Voice tests intentionally mock the Web Speech API (see e2e/fixtures/voice-e2e.ts).
 * Contract tier (e2e/contract): mocked LLM, runs on every PR.
 * Live tier (e2e/live): real LLM when LIVE_LLM=1, publish gate only.
 */
import { defineConfig, devices } from '@playwright/test';
import { resolveGuidekitSecret, resolveLlmApiKey } from './e2e/env';

const E2E_GUIDEKIT_SECRET = resolveGuidekitSecret();
const E2E_LLM_API_KEY = resolveLlmApiKey();

const sharedUse = {
  ...devices['Desktop Chrome'],
  baseURL: 'http://localhost:3099',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  expect: {
    timeout: 10_000,
  },

  use: {
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'contract',
      testDir: './e2e/contract',
      timeout: 30_000,
      use: sharedUse,
    },
    {
      name: 'live',
      testDir: './e2e/live',
      timeout: 120_000,
      retries: 2,
      use: sharedUse,
    },
  ],

  webServer: {
    command: 'pnpm --filter @guidekit/example-nextjs dev',
    env: {
      ...process.env,
      GUIDEKIT_SECRET: E2E_GUIDEKIT_SECRET,
      LLM_API_KEY: E2E_LLM_API_KEY,
      STT_API_KEY: process.env.STT_API_KEY ?? 'e2e-dummy-stt-key-for-contract-tests',
      TTS_API_KEY: process.env.TTS_API_KEY ?? 'e2e-dummy-tts-key-for-contract-tests',
    },
    url: 'http://localhost:3099',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
