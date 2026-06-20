import type { BrowserContext, Page } from '@playwright/test';
import { installVoiceBrowserMocks } from './voice-mocks';

/**
 * Contract-tier voice setup only — mocks Web Speech API (STT + mic).
 *
 * Do not import this from e2e/live specs. Live tier uses Chromium fake-audio-capture
 * with real Web Speech + real LLM (no Deepgram/ElevenLabs in Playwright).
 */
export async function setupVoiceE2e(
  page: Page,
  context: BrowserContext,
  transcript = 'hello from voice',
): Promise<void> {
  await context.grantPermissions(['microphone']);
  await installVoiceBrowserMocks(page, transcript);
}
