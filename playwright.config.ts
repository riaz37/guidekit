import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/** Load apps/example-nextjs/.env.local for local live-LLM runs (gitignored). */
function loadExampleEnvLocal(): Record<string, string> {
  const envPath = resolve(__dirname, 'apps/example-nextjs/.env.local');
  if (!existsSync(envPath)) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return vars;
}

const exampleEnv = loadExampleEnvLocal();

const E2E_GUIDEKIT_SECRET =
  process.env.GUIDEKIT_SECRET ??
  exampleEnv.GUIDEKIT_SECRET ??
  'guidekit-example-e2e-secret-32-chars';
const E2E_LLM_API_KEY =
  process.env.LLM_API_KEY ??
  exampleEnv.LLM_API_KEY ??
  'e2e-dummy-llm-key-for-contract-tests';

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
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'example-nextjs',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3099',
      },
    },
  ],

  webServer: {
    command: 'pnpm --filter @guidekit/example-nextjs dev',
    env: {
      ...process.env,
      GUIDEKIT_SECRET: E2E_GUIDEKIT_SECRET,
      LLM_API_KEY: E2E_LLM_API_KEY,
    },
    url: 'http://localhost:3099',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
