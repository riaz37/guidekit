import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fetchVoiceCredential, resolveSttConfig, resolveTtsConfig } from './voice-config.js';
import type { GuideKitCoreOptions } from './options.js';

describe('voice-config', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolveSttConfig returns web-speech by default', async () => {
    const config = await resolveSttConfig({}, false, () => null);
    expect(config.provider).toBe('web-speech');
  });

  it('resolveSttConfig returns inline apiKey without fetch', async () => {
    const options: GuideKitCoreOptions = {
      stt: { provider: 'deepgram', apiKey: 'inline-key' },
    };
    const config = await resolveSttConfig(options, true, () => 'token');
    expect(config).toEqual({ provider: 'deepgram', apiKey: 'inline-key' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('resolveSttConfig fetches key from proxy.stt', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ apiKey: 'dg-from-proxy' }), { status: 200 }),
    );

    const options: GuideKitCoreOptions = {
      tokenEndpoint: '/api/guidekit/token',
      proxy: { llm: '/api/guidekit/llm', stt: '/api/guidekit/stt' },
      stt: { provider: 'deepgram' },
    };

    const config = await resolveSttConfig(options, true, () => 'session-jwt');
    expect(config).toEqual({ provider: 'deepgram', apiKey: 'dg-from-proxy' });
    expect(fetch).toHaveBeenCalledWith('/api/guidekit/stt', {
      method: 'POST',
      headers: { Authorization: 'Bearer session-jwt' },
    });
  });

  it('fetchVoiceCredential retries after session stale 403', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'No STT API key for session' }), { status: 403 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ apiKey: 'refreshed-key' }), { status: 200 }),
      );

    const key = await fetchVoiceCredential('/api/guidekit/stt', () => 'jwt', refresh);
    expect(key).toBe('refreshed-key');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('resolveTtsConfig fetches key from proxy.tts', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ apiKey: 'el-from-proxy' }), { status: 200 }),
    );

    const options: GuideKitCoreOptions = {
      proxy: { llm: '/api/guidekit/llm', tts: '/api/guidekit/tts' },
      tts: { provider: 'elevenlabs' },
    };

    const config = await resolveTtsConfig(options, true, () => 'token');
    expect(config).toEqual({ provider: 'elevenlabs', apiKey: 'el-from-proxy' });
  });
});
