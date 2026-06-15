import { test, expect } from '@playwright/test';

test.describe('Proxy voice key minting', () => {
  test('POST /api/guidekit/stt returns ephemeral key when session has STT_API_KEY', async ({
    request,
  }) => {
    const tokenRes = await request.post('/api/guidekit/token');
    expect(tokenRes.ok()).toBeTruthy();
    const { token } = (await tokenRes.json()) as { token: string };

    const sttRes = await request.post('/api/guidekit/stt', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(sttRes.ok()).toBeTruthy();
    const body = (await sttRes.json()) as { kind: string; apiKey: string };
    expect(body.kind).toBe('stt');
    expect(body.apiKey.length).toBeGreaterThan(5);
  });

  test('POST /api/guidekit/tts returns ephemeral key when session has TTS_API_KEY', async ({
    request,
  }) => {
    const tokenRes = await request.post('/api/guidekit/token');
    const { token } = (await tokenRes.json()) as { token: string };

    const ttsRes = await request.post('/api/guidekit/tts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(ttsRes.ok()).toBeTruthy();
    const body = (await ttsRes.json()) as { kind: string; apiKey: string };
    expect(body.kind).toBe('tts');
    expect(body.apiKey.length).toBeGreaterThan(5);
  });

  test('STT and TTS routes reject GET', async ({ request }) => {
    expect((await request.get('/api/guidekit/stt')).status()).toBe(405);
    expect((await request.get('/api/guidekit/tts')).status()).toBe(405);
  });
});
