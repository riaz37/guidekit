import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export const DUMMY_LLM_KEY = 'e2e-dummy-llm-key-for-contract-tests';
export const DEFAULT_E2E_SECRET = 'guidekit-example-e2e-secret-32-chars';

/** Load apps/example-nextjs/.env.local for local live runs (gitignored). */
export function loadExampleEnvLocal(): Record<string, string> {
  const envPath = resolve(__dirname, '../apps/example-nextjs/.env.local');
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

export function resolveGuidekitSecret(): string {
  const exampleEnv = loadExampleEnvLocal();
  return process.env.GUIDEKIT_SECRET ?? exampleEnv.GUIDEKIT_SECRET ?? DEFAULT_E2E_SECRET;
}

export function resolveLlmApiKey(): string {
  const exampleEnv = loadExampleEnvLocal();
  return process.env.LLM_API_KEY ?? exampleEnv.LLM_API_KEY ?? DUMMY_LLM_KEY;
}

export function hasRealLlmApiKey(): boolean {
  const key = resolveLlmApiKey();
  return key.length > 10 && key !== DUMMY_LLM_KEY && !key.startsWith('e2e-dummy');
}

export function isLiveLlmEnabled(): boolean {
  return process.env.LIVE_LLM === '1' && hasRealLlmApiKey();
}

export function liveSkipReason(): string {
  if (process.env.LIVE_LLM !== '1') {
    return 'Set LIVE_LLM=1 to run live integration tests (pnpm test:e2e:live)';
  }
  if (!hasRealLlmApiKey()) {
    return 'Set LLM_API_KEY in env or apps/example-nextjs/.env.local';
  }
  return 'Live LLM tests disabled';
}
