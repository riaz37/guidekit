import { createSessionToken } from '@guidekit/server';

export async function POST() {
  const token = await createSessionToken({
    signingSecret: process.env.GUIDEKIT_SECRET || 'dev-secret-replace-in-production',
    expiresIn: '15m',
  });

  return Response.json(token);
}
