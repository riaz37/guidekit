/**
 * Playwright E2E for the example-nextjs app.
 *
 * Contract tier (e2e/contract): mocked LLM + Web Speech (see voice-e2e.ts).
 * Live tier (e2e/live): real Gemini, no LLM/Web Speech JS mocks; publish gate only.
 */
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { resolveGuidekitSecret, resolveLlmApiKey } from './e2e/env';

const E2E_GUIDEKIT_SECRET = resolveGuidekitSecret();
const E2E_LLM_API_KEY = resolveLlmApiKey();

const sharedUse = {
  ...devices['Desktop Chrome'],
  baseURL: 'http://localhost:3099',
};

const liveVoiceAudio = path.join(__dirname, 'e2e/fixtures/audio/voice-prompt.wav');

const liveUse = {
  ...sharedUse,
  permissions: ['microphone'] as const,
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${liveVoiceAudio}`,
    ],
  },
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
      use: liveUse,
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
