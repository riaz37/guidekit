/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RedisSessionStore } from './redis-session-store.js';
import { createSessionToken, validateSessionToken } from './auth.js';
import { handleLLMProxy } from './proxy/llm.js';
import { handleVoiceProxy } from './proxy/voice.js';

const TEST_SECRET = 'test-secret-that-is-long-enough-for-hmac-256-bits!!';

function createMockRedis() {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
    keys: async (pattern: string) =>
      [...store.keys()].filter((k) => k.startsWith(pattern.replace('*', ''))),
    _store: store,
  };
}

describe('RedisSessionStore', () => {
  let redis: ReturnType<typeof createMockRedis>;
  let sessionStore: RedisSessionStore;

  beforeEach(() => {
    redis = createMockRedis();
    sessionStore = new RedisSessionStore({ redis, ttlSeconds: 900 });
  });

  it('stores and retrieves provider keys', async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 900;
    await sessionStore.set('sess-1', { llmApiKey: 'gem-key' }, expiresAt);

    const keys = await sessionStore.get('sess-1');
    expect(keys?.llmApiKey).toBe('gem-key');
  });

  it('returns undefined for missing session', async () => {
    expect(await sessionStore.get('missing')).toBeUndefined();
  });

  it('delete removes session keys', async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 900;
    await sessionStore.set('sess-del', { llmApiKey: 'x' }, expiresAt);
    expect(await sessionStore.delete('sess-del')).toBe(true);
    expect(await sessionStore.get('sess-del')).toBeUndefined();
  });

  it('works with LLM proxy handler', async () => {
    const sessionId = `redis-llm-${Date.now()}`;
    const { token } = await createSessionToken({
      signingSecret: TEST_SECRET,
      sessionId,
      llmApiKey: 'gem-proxy-key',
      sessionStore,
    });

    const res = await handleLLMProxy(
      new Request('http://localhost/llm', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'gemini',
          systemPrompt: 'test',
          contents: [],
          userMessage: 'hi',
        }),
      }),
      { signingSecret: TEST_SECRET, sessionStore },
    );

    expect(res.status).not.toBe(403);
  });

  it('works with voice proxy handler', async () => {
    const sessionId = `redis-voice-${Date.now()}`;
    const { token } = await createSessionToken({
      signingSecret: TEST_SECRET,
      sessionId,
      sttApiKey: 'dg-key',
      sessionStore,
    });

    const res = await handleVoiceProxy(
      new Request('http://localhost/stt', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
      { signingSecret: TEST_SECRET, sessionStore, kind: 'stt' },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { apiKey: string };
    expect(body.apiKey).toBe('dg-key');
  });
});

describe('handleLLMProxy auth contract', () => {
  it('rejects missing bearer token with 401', async () => {
    const res = await handleLLMProxy(
      new Request('http://localhost/llm', { method: 'POST', body: '{}' }),
      { signingSecret: TEST_SECRET, sessionStore: new RedisSessionStore({ redis: createMockRedis() }) },
    );
    expect(res.status).toBe(401);
  });

  it('rejects session without LLM key with 401', async () => {
    const sessionId = `no-llm-${Date.now()}`;
    const { token } = await createSessionToken({
      signingSecret: TEST_SECRET,
      sessionId,
    });

    const res = await handleLLMProxy(
      new Request('http://localhost/llm', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'gemini',
          systemPrompt: 'test',
          contents: [],
        }),
      }),
      { signingSecret: TEST_SECRET, sessionStore: new RedisSessionStore({ redis: createMockRedis() }) },
    );
    expect(res.status).toBe(401);
  });
});

describe('validateSessionToken with Redis-backed store', () => {
  it('round-trips token validation after async store write', async () => {
    const redis = createMockRedis();
    const sessionStore = new RedisSessionStore({ redis });
    const sessionId = `roundtrip-${Date.now()}`;

    const { token } = await createSessionToken({
      signingSecret: TEST_SECRET,
      sessionId,
      llmApiKey: 'key',
      sessionStore,
    });

    const validation = await validateSessionToken(token, TEST_SECRET);
    expect(validation.valid).toBe(true);
    expect(await sessionStore.get(sessionId)).toEqual({ llmApiKey: 'key' });
  });
});
