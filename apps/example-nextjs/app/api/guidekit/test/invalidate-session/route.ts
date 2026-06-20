import { clearSessionKeys, validateSessionToken } from '@guidekit/server';
import { NextResponse } from 'next/server';
import { guidekitSessionStore } from '../../../../../lib/guidekit-session-store';

/**
 * Dev/E2E only — clears server-side session keys so the next LLM proxy call
 * returns 401 and the client can exercise real session recovery.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const signingSecret = process.env.GUIDEKIT_SECRET;
  if (!signingSecret) {
    return NextResponse.json({ error: 'GUIDEKIT_SECRET not configured' }, { status: 500 });
  }

  let token: string | undefined;
  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) {
    token = auth.slice(7).trim();
  } else {
    try {
      const body = (await request.json()) as { token?: string };
      token = typeof body.token === 'string' ? body.token.trim() : undefined;
    } catch {
      token = undefined;
    }
  }

  if (!token) {
    return NextResponse.json({ error: 'Missing session token' }, { status: 400 });
  }

  const validation = await validateSessionToken(token, signingSecret);
  if (!validation.valid || !validation.payload) {
    return NextResponse.json({ error: validation.error ?? 'Invalid token' }, { status: 401 });
  }

  const deleted = await clearSessionKeys(validation.payload.sessionId, guidekitSessionStore);
  return NextResponse.json({ ok: true, deleted });
}
