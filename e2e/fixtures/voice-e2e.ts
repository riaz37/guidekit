import type { BrowserContext, Page } from '@playwright/test';
import { installVoiceBrowserMocks } from './voice-mocks';

/**
 * E2E voice policy: always use mocked Web Speech API (STT + mic).
 *
 * We do not run Playwright against Deepgram, ElevenLabs, or server STT/TTS
 * proxies — those need paid keys, real audio, and are flaky in CI. Contract
 * and live voice specs exercise the same browser path the example app uses by
 * default (web-speech provider + @guidekit/vad).
 */
export async function setupVoiceE2e(
  page: Page,
  context: BrowserContext,
  transcript = 'hello from voice',
): Promise<void> {
  await context.grantPermissions(['microphone']);
  await installVoiceBrowserMocks(page, transcript);
}
