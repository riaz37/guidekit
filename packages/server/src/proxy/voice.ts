/**
 * @module @guidekit/server/proxy/voice
 *
 * STT/TTS credential proxy. Validates session JWT and returns ephemeral
 * provider keys for client-side voice connections (never stored in JWT).
 */

import type { SessionStore } from '../session-store.js';
import { validateSessionToken } from '../auth.js';

export type VoiceProxyKind = 'stt' | 'tts';

export interface VoiceProxyOptions {
  signingSecret: string | string[];
  sessionStore: SessionStore;
  kind: VoiceProxyKind;
}

function requestOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin');
  return origin && origin.trim().length > 0 ? origin : null;
}

function enforceAllowedOrigins(
  allowedOrigins: string[] | undefined,
  origin: string | null,
): Response | null {
  if (!allowedOrigins || allowedOrigins.length === 0) return null;
  if (!origin) {
    return jsonResponse({ error: 'Missing Origin header' }, 403);
  }
  if (!allowedOrigins.includes(origin)) {
    return jsonResponse({ error: 'Origin not allowed' }, 403);
  }
  return null;
}

function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice(7).trim() || null;
}

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' },
  });
}

/**
 * Mint ephemeral voice credentials for an authenticated session.
 * POST with Authorization: Bearer <session-token>
 */
export async function handleVoiceProxy(
  request: Request,
  options: VoiceProxyOptions,
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const token = extractBearerToken(request);
  if (!token) {
    return jsonResponse({ error: 'Missing Authorization Bearer token' }, 401);
  }

  const validation = await validateSessionToken(token, options.signingSecret);
  if (!validation.valid || !validation.payload) {
    return jsonResponse({ error: validation.error ?? 'Invalid token' }, 401);
  }

  const origin = requestOrigin(request);
  const originCheck = enforceAllowedOrigins(validation.payload.audience, origin);
  if (originCheck) return originCheck;

  const permissions = validation.payload.permissions ?? ['stt', 'tts', 'llm'];
  if (!permissions.includes(options.kind)) {
    return jsonResponse({ error: `Permission "${options.kind}" not granted` }, 403);
  }

  const keys = await options.sessionStore.get(validation.payload.sessionId);
  const apiKey =
    options.kind === 'stt' ? keys?.sttApiKey : keys?.ttsApiKey;

  if (!apiKey) {
    return jsonResponse(
      { error: `No ${options.kind.toUpperCase()} API key for session` },
      403,
    );
  }

  return jsonResponse(
    {
      kind: options.kind,
      apiKey,
      sessionId: validation.payload.sessionId,
      expiresAt: validation.payload.expiresAt,
    },
    200,
  );
}
