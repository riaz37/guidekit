/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { handleVoiceProxy } from './voice.js';
import { createSessionToken } from '../auth.js';
import { InMemorySessionStore } from '../session-store.js';

const TEST_SECRET = 'test-secret-that-is-long-enough-for-hmac-256-bits!!';

describe('handleVoiceProxy', () => {
  it('rejects when permission is not granted', async () => {
    const store = new InMemorySessionStore();
    const { token } = await createSessionToken({
      signingSecret: TEST_SECRET,
      sessionId: 'voice-no-perm',
      sttApiKey: 'dg-key',
      permissions: ['llm'],
      sessionStore: store,
    });

    const req = new Request('http://localhost/api/guidekit/stt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await handleVoiceProxy(req, {
      signingSecret: TEST_SECRET,
      sessionStore: store,
      kind: 'stt',
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Permission "stt"');
  });

  it('enforces allowedOrigins when token includes aud', async () => {
    const store = new InMemorySessionStore();
    const { token } = await createSessionToken({
      signingSecret: TEST_SECRET,
      sessionId: 'voice-origin',
      sttApiKey: 'dg-key',
      allowedOrigins: ['https://app.example.com'],
      sessionStore: store,
    });

    const req = new Request('http://localhost/api/guidekit/stt', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://evil.example.com',
      },
    });

    const res = await handleVoiceProxy(req, {
      signingSecret: TEST_SECRET,
      sessionStore: store,
      kind: 'stt',
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Origin');
  });
});

