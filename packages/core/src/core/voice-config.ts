import { AuthenticationError, ConfigurationError, ErrorCodes, NetworkError } from '../errors/index.js';
import type { STTConfig, TTSConfig } from '../types/index.js';
import type { GuideKitCoreOptions } from './options.js';

export type ResolvedSttConfig = STTConfig & (
  | { provider: 'web-speech' }
  | { provider: 'deepgram'; apiKey: string }
  | { provider: 'elevenlabs'; apiKey: string }
);

export type ResolvedTtsConfig = TTSConfig & (
  | { provider: 'web-speech' }
  | { provider: 'elevenlabs'; apiKey: string }
);

/** Fetch ephemeral STT/TTS API key from server voice proxy. */
export async function fetchVoiceCredential(
  endpoint: string,
  getToken: () => string | null,
  refreshSession?: () => Promise<void>,
  retried = false,
): Promise<string> {
  const token = getToken();
  if (!token) {
    throw new AuthenticationError({
      code: ErrorCodes.AUTH_EXPIRED_TOKEN,
      message: 'Session token required for voice proxy requests.',
      suggestion: 'Ensure tokenEndpoint is configured and init() completed.',
    });
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    const sessionStale =
      (response.status === 401 || response.status === 403) &&
      (errorBody.includes('No STT API key') ||
        errorBody.includes('No TTS API key') ||
        errorBody.includes('Session expired'));

    if (sessionStale && refreshSession && !retried) {
      await refreshSession();
      return fetchVoiceCredential(endpoint, getToken, refreshSession, true);
    }

    throw new NetworkError({
      code: ErrorCodes.NETWORK_CONNECTION_LOST,
      message: `Voice proxy request failed (${response.status}): ${errorBody}`,
      suggestion: 'Check server STT_API_KEY / TTS_API_KEY and proxy routes.',
    });
  }

  const data = (await response.json()) as { apiKey?: string };
  if (!data.apiKey) {
    throw new ConfigurationError({
      code: ErrorCodes.CONFIG_MISSING_REQUIRED,
      message: 'Voice proxy response missing apiKey.',
      suggestion: 'Verify handleVoiceProxy returns { apiKey } for authenticated sessions.',
    });
  }

  return data.apiKey;
}

export async function resolveSttConfig(
  options: GuideKitCoreOptions,
  hasTokenManager: boolean,
  getToken: () => string | null,
  refreshSession?: () => Promise<void>,
): Promise<ResolvedSttConfig> {
  const stt = options.stt ?? { provider: 'web-speech' as const };
  if (stt.provider === 'web-speech') return stt;

  if (stt.apiKey) {
    return stt as ResolvedSttConfig;
  }

  const proxyEndpoint = options.proxy?.stt;
  if (proxyEndpoint && hasTokenManager) {
    const apiKey = await fetchVoiceCredential(proxyEndpoint, getToken, refreshSession);
    return { ...stt, apiKey } as ResolvedSttConfig;
  }

  throw new ConfigurationError({
    code: ErrorCodes.CONFIG_MISSING_REQUIRED,
    message: `STT provider "${stt.provider}" requires apiKey or proxy.stt with tokenEndpoint.`,
    suggestion:
      'Use proxy={{ stt: "/api/guidekit/stt" }} with tokenEndpoint, or pass apiKey for local dev.',
  });
}

export async function resolveTtsConfig(
  options: GuideKitCoreOptions,
  hasTokenManager: boolean,
  getToken: () => string | null,
  refreshSession?: () => Promise<void>,
): Promise<ResolvedTtsConfig> {
  const tts = options.tts ?? { provider: 'web-speech' as const };
  if (tts.provider === 'web-speech') return tts;

  if (tts.apiKey) {
    return tts as ResolvedTtsConfig;
  }

  const proxyEndpoint = options.proxy?.tts;
  if (proxyEndpoint && hasTokenManager) {
    const apiKey = await fetchVoiceCredential(proxyEndpoint, getToken, refreshSession);
    return { ...tts, apiKey } as ResolvedTtsConfig;
  }

  throw new ConfigurationError({
    code: ErrorCodes.CONFIG_MISSING_REQUIRED,
    message: 'TTS provider "elevenlabs" requires apiKey or proxy.tts with tokenEndpoint.',
    suggestion:
      'Use proxy={{ tts: "/api/guidekit/tts" }} with tokenEndpoint, or pass apiKey for local dev.',
  });
}
