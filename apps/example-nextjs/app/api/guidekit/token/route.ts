import { createSessionToken } from '@guidekit/server';

export async function POST() {
  const secret = process.env.GUIDEKIT_SECRET;
  if (!secret) {
    throw new Error('GUIDEKIT_SECRET environment variable is required');
  }

  const token = await createSessionToken({
    signingSecret: secret,
    expiresIn: '15m',
  });

  return Response.json(token);
}
