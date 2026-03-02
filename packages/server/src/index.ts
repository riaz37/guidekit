import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenPayload {
  sessionId: string;
  expiresAt: number;
  audience: string[];
  permissions: string[];
  userId?: string;
  metadata?: Record<string, unknown>;
  iat: number;
}

export interface CreateSessionTokenOptions {
  signingSecret: string | string[];
  sttApiKey?: string;
  ttsApiKey?: string;
  llmApiKey?: string;
  expiresIn?: string;
  allowedOrigins?: string[];
  permissions?: string[];
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateSessionTokenResult {
  token: string;
  expiresIn: number;
  expiresAt: number;
}

export interface ValidateSessionTokenResult {
  valid: boolean;
  payload?: TokenPayload;
  error?: string;
}

export interface ValidateSessionTokenOptions {
  audience?: string;
}

// ---------------------------------------------------------------------------
// Server-side provider key store
// ---------------------------------------------------------------------------

interface ProviderKeys {
  sttApiKey?: string;
  ttsApiKey?: string;
  llmApiKey?: string;
}

/**
 * In-memory store mapping sessionId -> provider API keys.
 * Provider keys are NEVER placed in the JWT; they stay server-side only.
 */
const sessionKeyStore = new Map<string, ProviderKeys>();

/**
 * Retrieve provider API keys associated with a session.
 * Returns `undefined` if the session is not found.
 */
export function getSessionKeys(sessionId: string): ProviderKeys | undefined {
  return sessionKeyStore.get(sessionId);
}

/**
 * Remove provider API keys for a session (e.g. on expiry or logout).
 */
export function clearSessionKeys(sessionId: string): boolean {
  return sessionKeyStore.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Duration parsing
// ---------------------------------------------------------------------------

/**
 * Parse a human-readable duration string into seconds.
 *
 * Supported units:
 *  - `s` seconds
 *  - `m` minutes
 *  - `h` hours
 *  - `d` days
 *
 * Compound durations are supported (e.g. `2h30m`, `1d12h`).
 *
 * @throws {Error} If the duration string is empty or contains no valid segments.
 */
function parseDuration(duration: string): number {
  if (typeof duration !== 'string' || duration.trim().length === 0) {
    throw new Error('Duration must be a non-empty string (e.g. "15m", "1h", "30s").');
  }

  const cleaned = duration.trim().toLowerCase();
  const regex = /(\d+)\s*(d|h|m|s)/g;
  let match: RegExpExecArray | null;
  let totalSeconds = 0;
  let matched = false;

  while ((match = regex.exec(cleaned)) !== null) {
    matched = true;
    const value = parseInt(match[1]!, 10);
    const unit = match[2]!;

    switch (unit) {
      case 's':
        totalSeconds += value;
        break;
      case 'm':
        totalSeconds += value * 60;
        break;
      case 'h':
        totalSeconds += value * 3600;
        break;
      case 'd':
        totalSeconds += value * 86400;
        break;
    }
  }

  if (!matched) {
    throw new Error(
      `Invalid duration format: "${duration}". ` +
        'Expected a string like "15m", "1h", "30s", "7d", or compound "2h30m".',
    );
  }

  if (totalSeconds <= 0) {
    throw new Error('Duration must resolve to a positive number of seconds.');
  }

  return totalSeconds;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Encode a signing secret string into a Uint8Array suitable for HMAC operations.
 */
function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/**
 * Resolve the signing secret to use.
 *
 * - If a single string is provided, it is used directly.
 * - If an array is provided, the **first** element (newest) is used for signing.
 *
 * @throws {Error} If no signing secret is provided or the array is empty.
 */
function resolveSigningSecret(signingSecret: string | string[]): string {
  if (Array.isArray(signingSecret)) {
    if (signingSecret.length === 0) {
      throw new Error('signingSecret array must contain at least one secret.');
    }
    return signingSecret[0]!;
  }

  if (typeof signingSecret !== 'string' || signingSecret.length === 0) {
    throw new Error('signingSecret must be a non-empty string or a non-empty array of strings.');
  }

  return signingSecret;
}

/**
 * Flatten signingSecret into an array for rotation-aware verification.
 */
function resolveAllSecrets(signingSecret: string | string[]): string[] {
  if (Array.isArray(signingSecret)) {
    if (signingSecret.length === 0) {
      throw new Error('signingSecret array must contain at least one secret.');
    }
    return signingSecret;
  }

  if (typeof signingSecret !== 'string' || signingSecret.length === 0) {
    throw new Error('signingSecret must be a non-empty string or a non-empty array of strings.');
  }

  return [signingSecret];
}

// ---------------------------------------------------------------------------
// createSessionToken
// ---------------------------------------------------------------------------

/**
 * Create a signed session token (JWT) for use with GuideKit client SDKs.
 *
 * Provider API keys (`sttApiKey`, `ttsApiKey`, `llmApiKey`) are
 * **never** embedded in the JWT. They are stored in a server-side in-memory
 * map keyed by `sessionId` and can be retrieved via {@link getSessionKeys}.
 */
export async function createSessionToken(
  options: CreateSessionTokenOptions,
): Promise<CreateSessionTokenResult> {
  const {
    signingSecret,
    sttApiKey,
    ttsApiKey,
    llmApiKey,
    expiresIn = '15m',
    allowedOrigins,
    permissions = ['stt', 'tts', 'llm'],
    userId,
    sessionId = crypto.randomUUID(),
    metadata,
  } = options;

  // Resolve the secret to sign with (first / newest).
  const secret = resolveSigningSecret(signingSecret);

  // Parse the requested lifetime.
  const lifetimeSeconds = parseDuration(expiresIn);

  // Build the JWT payload — provider keys are intentionally excluded.
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + lifetimeSeconds;

  const jwtPayload: JWTPayload & {
    sessionId: string;
    permissions: string[];
    userId?: string;
    metadata?: Record<string, unknown>;
  } = {
    sessionId,
    permissions,
  };

  if (userId !== undefined) {
    jwtPayload.userId = userId;
  }

  if (metadata !== undefined && Object.keys(metadata).length > 0) {
    jwtPayload.metadata = metadata;
  }

  if (allowedOrigins !== undefined && allowedOrigins.length > 0) {
    jwtPayload.aud = allowedOrigins;
  }

  const token = await new SignJWT(jwtPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(encodeSecret(secret));

  // Store provider keys server-side, keyed by sessionId.
  const providerKeys: ProviderKeys = {};
  if (sttApiKey) providerKeys.sttApiKey = sttApiKey;
  if (ttsApiKey) providerKeys.ttsApiKey = ttsApiKey;
  if (llmApiKey) providerKeys.llmApiKey = llmApiKey;

  if (Object.keys(providerKeys).length > 0) {
    sessionKeyStore.set(sessionId, providerKeys);
  }

  return {
    token,
    expiresIn: lifetimeSeconds,
    expiresAt,
  };
}

// ---------------------------------------------------------------------------
// validateSessionToken
// ---------------------------------------------------------------------------

/**
 * Validate and decode a GuideKit session token.
 *
 * When `signingSecret` is an array, the function tries each secret in order
 * to support zero-downtime key rotation. Verification succeeds as soon as
 * any secret produces a valid result.
 */
export async function validateSessionToken(
  token: string,
  signingSecret: string | string[],
  options?: ValidateSessionTokenOptions,
): Promise<ValidateSessionTokenResult> {
  if (typeof token !== 'string' || token.trim().length === 0) {
    return { valid: false, error: 'Token must be a non-empty string.' };
  }

  const secrets = resolveAllSecrets(signingSecret);
  let lastError: unknown;

  for (const secret of secrets) {
    try {
      const verifyOptions: Parameters<typeof jwtVerify>[2] = {
        algorithms: ['HS256'],
      };

      if (options?.audience) {
        verifyOptions.audience = options.audience;
      }

      const { payload } = await jwtVerify(token, encodeSecret(secret), verifyOptions);

      const tokenPayload: TokenPayload = {
        sessionId: payload.sessionId as string,
        expiresAt: payload.exp as number,
        audience: normalizeAudience(payload.aud),
        permissions: (payload.permissions as string[]) ?? [],
        iat: payload.iat as number,
      };

      if (payload.userId !== undefined) {
        tokenPayload.userId = payload.userId as string;
      }

      if (payload.metadata !== undefined) {
        tokenPayload.metadata = payload.metadata as Record<string, unknown>;
      }

      return { valid: true, payload: tokenPayload };
    } catch (err) {
      lastError = err;
      // Continue to next secret — it may have been rotated.
    }
  }

  // All secrets failed.
  const message =
    lastError instanceof Error ? lastError.message : 'Token validation failed.';
  return { valid: false, error: message };
}

/**
 * Normalize the JWT `aud` claim into a string array.
 */
function normalizeAudience(aud: unknown): string[] {
  if (aud === undefined || aud === null) return [];
  if (typeof aud === 'string') return [aud];
  if (Array.isArray(aud)) return aud.filter((a): a is string => typeof a === 'string');
  return [];
}

// ---------------------------------------------------------------------------
// generateSecret
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random 256-bit (32-byte) base64url-encoded
 * secret suitable for use as a GuideKit signing secret.
 *
 * Usage: `npx guidekit generate-secret`
 */
export function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * Base64url-encode a Uint8Array without padding, per RFC 4648 section 5.
 */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
