/**
 * Unit tests for the GuideKit server package:
 * - createSessionToken
 * - validateSessionToken
 * - generateSecret
 * - parseDuration (tested indirectly via createSessionToken)
 * - getSessionKeys
 *
 * @module @guidekit/server
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSessionToken,
  validateSessionToken,
  generateSecret,
  getSessionKeys,
  clearSessionKeys,
} from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decode a JWT payload without signature verification.
 * Useful for inspecting claims that should (or should not) be present.
 */
function decodePayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  return JSON.parse(atob(payload!.replace(/-/g, '+').replace(/_/g, '/')));
}

const TEST_SECRET = 'test-secret-that-is-long-enough-for-hmac-256-bits!!';
const ALT_SECRET = 'alternate-secret-for-rotation-testing-long-enough!!';

// ---------------------------------------------------------------------------
// createSessionToken
// ---------------------------------------------------------------------------

describe('createSessionToken()', () => {
  it('returns token, expiresIn, and expiresAt', async () => {
    const result = await createSessionToken({
      signingSecret: TEST_SECRET,
      expiresIn: '15m',
    });

    expect(result).toHaveProperty('token');
    expect(result).toHaveProperty('expiresIn');
    expect(result).toHaveProperty('expiresAt');
    expect(typeof result.token).toBe('string');
    expect(result.expiresIn).toBe(900); // 15 * 60
    expect(typeof result.expiresAt).toBe('number');
  });

  it('token does NOT contain provider keys in payload', async () => {
    const result = await createSessionToken({
      signingSecret: TEST_SECRET,
      deepgramKey: 'dg-secret-key',
      elevenlabsKey: 'el-secret-key',
      geminiKey: 'gem-secret-key',
      expiresIn: '15m',
    });

    const payload = decodePayload(result.token);

    // Provider keys must NEVER appear in the JWT
    expect(payload).not.toHaveProperty('deepgramKey');
    expect(payload).not.toHaveProperty('elevenlabsKey');
    expect(payload).not.toHaveProperty('geminiKey');
    expect(payload).not.toHaveProperty('dg-secret-key');
    expect(payload).not.toHaveProperty('el-secret-key');
    expect(payload).not.toHaveProperty('gem-secret-key');

    // Verify the raw token string does not contain the key values
    expect(result.token).not.toContain('dg-secret-key');
    expect(result.token).not.toContain('el-secret-key');
    expect(result.token).not.toContain('gem-secret-key');
  });

  it('includes sessionId, permissions, and iat in payload', async () => {
    const result = await createSessionToken({
      signingSecret: TEST_SECRET,
      sessionId: 'custom-session-id',
      permissions: ['stt', 'tts'],
      expiresIn: '1h',
    });

    const payload = decodePayload(result.token);
    expect(payload.sessionId).toBe('custom-session-id');
    expect(payload.permissions).toEqual(['stt', 'tts']);
    expect(payload.iat).toBeDefined();
    expect(payload.exp).toBeDefined();
  });

  it('includes userId and metadata when provided', async () => {
    const result = await createSessionToken({
      signingSecret: TEST_SECRET,
      userId: 'user-42',
      metadata: { tier: 'pro', featureFlags: ['beta'] },
    });

    const payload = decodePayload(result.token);
    expect(payload.userId).toBe('user-42');
    expect(payload.metadata).toEqual({ tier: 'pro', featureFlags: ['beta'] });
  });

  it('sets audience claim when allowedOrigins provided', async () => {
    const result = await createSessionToken({
      signingSecret: TEST_SECRET,
      allowedOrigins: ['https://example.com', 'https://app.example.com'],
    });

    const payload = decodePayload(result.token);
    expect(payload.aud).toEqual(['https://example.com', 'https://app.example.com']);
  });
});

// ---------------------------------------------------------------------------
// validateSessionToken
// ---------------------------------------------------------------------------

describe('validateSessionToken()', () => {
  it('accepts a valid token', async () => {
    const { token } = await createSessionToken({
      signingSecret: TEST_SECRET,
      expiresIn: '15m',
      sessionId: 'valid-session',
    });

    const result = await validateSessionToken(token, TEST_SECRET);

    expect(result.valid).toBe(true);
    expect(result.payload).toBeDefined();
    expect(result.payload!.sessionId).toBe('valid-session');
  });

  it('rejects an expired token', async () => {
    // Create a token that expires in 1 second
    const { token } = await createSessionToken({
      signingSecret: TEST_SECRET,
      expiresIn: '1s',
    });

    // Wait for it to expire
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const result = await validateSessionToken(token, TEST_SECRET);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  }, 5000);

  it('rejects a token signed with a different secret', async () => {
    const { token } = await createSessionToken({
      signingSecret: TEST_SECRET,
      expiresIn: '15m',
    });

    const result = await validateSessionToken(token, 'wrong-secret-entirely-different');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('with audience validation — accepts matching audience', async () => {
    const { token } = await createSessionToken({
      signingSecret: TEST_SECRET,
      allowedOrigins: ['https://example.com'],
      expiresIn: '15m',
    });

    const result = await validateSessionToken(token, TEST_SECRET, {
      audience: 'https://example.com',
    });

    expect(result.valid).toBe(true);
  });

  it('with audience validation — rejects non-matching audience', async () => {
    const { token } = await createSessionToken({
      signingSecret: TEST_SECRET,
      allowedOrigins: ['https://example.com'],
      expiresIn: '15m',
    });

    const result = await validateSessionToken(token, TEST_SECRET, {
      audience: 'https://evil.com',
    });

    expect(result.valid).toBe(false);
  });

  it('returns error for empty token string', async () => {
    const result = await validateSessionToken('', TEST_SECRET);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('non-empty');
  });

  it('returns error for whitespace-only token', async () => {
    const result = await validateSessionToken('   ', TEST_SECRET);
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Secret rotation
// ---------------------------------------------------------------------------

describe('secret rotation', () => {
  it('sign with new secret, validate with [new, old]', async () => {
    // Sign with the new secret (first in array)
    const { token } = await createSessionToken({
      signingSecret: [ALT_SECRET, TEST_SECRET],
      expiresIn: '15m',
    });

    // Validate with both secrets — should succeed with the new one
    const result = await validateSessionToken(token, [ALT_SECRET, TEST_SECRET]);
    expect(result.valid).toBe(true);
  });

  it('validates token signed with old secret using [new, old] array', async () => {
    // Sign with the old secret directly
    const { token } = await createSessionToken({
      signingSecret: TEST_SECRET,
      expiresIn: '15m',
    });

    // Validate with [new, old] — should succeed with the old one
    const result = await validateSessionToken(token, [ALT_SECRET, TEST_SECRET]);
    expect(result.valid).toBe(true);
  });

  it('fails when token is signed with a secret not in the rotation array', async () => {
    const { token } = await createSessionToken({
      signingSecret: 'secret-not-in-rotation-array-at-all-long-enough',
      expiresIn: '15m',
    });

    const result = await validateSessionToken(token, [ALT_SECRET, TEST_SECRET]);
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateSecret
// ---------------------------------------------------------------------------

describe('generateSecret()', () => {
  it('returns a 256-bit base64url string', () => {
    const secret = generateSecret();

    expect(typeof secret).toBe('string');
    // 32 bytes in base64url = ceil(32 * 4/3) = 43 chars (no padding)
    expect(secret.length).toBe(43);

    // Should only contain base64url characters (no +, /, or =)
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates unique values on each call', () => {
    const secrets = new Set<string>();
    for (let i = 0; i < 50; i++) {
      secrets.add(generateSecret());
    }
    // All 50 should be unique (astronomically unlikely to collide)
    expect(secrets.size).toBe(50);
  });

  it('output decodes to exactly 32 bytes', () => {
    const secret = generateSecret();
    // Reverse base64url to base64
    const base64 = secret.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(base64);
    expect(decoded.length).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// parseDuration (tested via createSessionToken)
// ---------------------------------------------------------------------------

describe('parseDuration (via createSessionToken)', () => {
  it.each([
    ['15m', 900],
    ['1h', 3600],
    ['30s', 30],
    ['7d', 604800],
    ['2h30m', 9000],
    ['1d12h', 129600],
  ])('handles "%s" -> %d seconds', async (duration, expectedSeconds) => {
    const result = await createSessionToken({
      signingSecret: TEST_SECRET,
      expiresIn: duration,
    });

    expect(result.expiresIn).toBe(expectedSeconds);
  });

  it('invalid duration throws', async () => {
    await expect(
      createSessionToken({
        signingSecret: TEST_SECRET,
        expiresIn: 'invalid',
      }),
    ).rejects.toThrow('Invalid duration format');
  });

  it('empty duration throws', async () => {
    await expect(
      createSessionToken({
        signingSecret: TEST_SECRET,
        expiresIn: '',
      }),
    ).rejects.toThrow('non-empty');
  });
});

// ---------------------------------------------------------------------------
// Empty secret validation
// ---------------------------------------------------------------------------

describe('empty secret validation', () => {
  it('empty string secret throws', async () => {
    await expect(
      createSessionToken({
        signingSecret: '',
        expiresIn: '15m',
      }),
    ).rejects.toThrow();
  });

  it('empty array secret throws', async () => {
    await expect(
      createSessionToken({
        signingSecret: [],
        expiresIn: '15m',
      }),
    ).rejects.toThrow('at least one secret');
  });
});

// ---------------------------------------------------------------------------
// Provider keys stored server-side
// ---------------------------------------------------------------------------

describe('getSessionKeys()', () => {
  beforeEach(() => {
    // Clear any leftover sessions from previous tests
    // We will use unique session IDs to avoid cross-test interference
  });

  it('stores provider keys server-side and retrieves them via getSessionKeys()', async () => {
    const sessionId = `server-keys-${Date.now()}`;

    await createSessionToken({
      signingSecret: TEST_SECRET,
      sessionId,
      deepgramKey: 'dg-key-123',
      elevenlabsKey: 'el-key-456',
      geminiKey: 'gem-key-789',
    });

    const keys = getSessionKeys(sessionId);
    expect(keys).toBeDefined();
    expect(keys!.deepgramKey).toBe('dg-key-123');
    expect(keys!.elevenlabsKey).toBe('el-key-456');
    expect(keys!.geminiKey).toBe('gem-key-789');
  });

  it('returns undefined for unknown session', () => {
    const keys = getSessionKeys('nonexistent-session-id');
    expect(keys).toBeUndefined();
  });

  it('does not store keys when no provider keys are provided', async () => {
    const sessionId = `no-keys-${Date.now()}`;

    await createSessionToken({
      signingSecret: TEST_SECRET,
      sessionId,
      expiresIn: '15m',
    });

    const keys = getSessionKeys(sessionId);
    expect(keys).toBeUndefined();
  });

  it('clearSessionKeys() removes stored keys', async () => {
    const sessionId = `clear-keys-${Date.now()}`;

    await createSessionToken({
      signingSecret: TEST_SECRET,
      sessionId,
      geminiKey: 'gem-key-to-clear',
    });

    expect(getSessionKeys(sessionId)).toBeDefined();

    const deleted = clearSessionKeys(sessionId);
    expect(deleted).toBe(true);
    expect(getSessionKeys(sessionId)).toBeUndefined();
  });

  it('clearSessionKeys() returns false for unknown session', () => {
    const deleted = clearSessionKeys('does-not-exist');
    expect(deleted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Token payload integrity
// ---------------------------------------------------------------------------

describe('token payload integrity', () => {
  it('validated payload matches original creation parameters', async () => {
    const sessionId = `integrity-${Date.now()}`;
    const { token } = await createSessionToken({
      signingSecret: TEST_SECRET,
      sessionId,
      permissions: ['stt', 'llm'],
      userId: 'user-99',
      allowedOrigins: ['https://app.test'],
      metadata: { plan: 'enterprise' },
      expiresIn: '1h',
    });

    const result = await validateSessionToken(token, TEST_SECRET, {
      audience: 'https://app.test',
    });

    expect(result.valid).toBe(true);
    const p = result.payload!;

    expect(p.sessionId).toBe(sessionId);
    expect(p.permissions).toEqual(['stt', 'llm']);
    expect(p.userId).toBe('user-99');
    expect(p.audience).toEqual(['https://app.test']);
    expect(p.metadata).toEqual({ plan: 'enterprise' });
    expect(p.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(p.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });

  it('default permissions are [stt, tts, llm]', async () => {
    const { token } = await createSessionToken({
      signingSecret: TEST_SECRET,
    });

    const payload = decodePayload(token);
    expect(payload.permissions).toEqual(['stt', 'tts', 'llm']);
  });

  it('default expiresIn is 15m (900s)', async () => {
    const result = await createSessionToken({
      signingSecret: TEST_SECRET,
    });

    expect(result.expiresIn).toBe(900);
  });
});
