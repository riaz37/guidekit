import { createNextAppRouterRoutes } from '@guidekit/server/next';
import { guidekitSessionStore } from './guidekit-session-store';

function parseAllowedOrigins(): string[] | undefined {
  const raw = process.env.GUIDEKIT_ALLOWED_ORIGINS;
  if (!raw) return undefined;
  const origins = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return origins.length > 0 ? origins : undefined;
}

export const guidekitRoutes = createNextAppRouterRoutes({
  signingSecret: process.env.GUIDEKIT_SECRET!,
  sessionStore: guidekitSessionStore,
  rateLimit: {
    windowMs: Number(process.env.GUIDEKIT_RATE_LIMIT_WINDOW_MS ?? 60_000),
    maxRequests: Number(process.env.GUIDEKIT_RATE_LIMIT_MAX ?? 60),
  },
  createTokenOptions: () => ({
    llmApiKey: process.env.LLM_API_KEY!,
    sttApiKey: process.env.STT_API_KEY,
    ttsApiKey: process.env.TTS_API_KEY,
    expiresIn: '15m',
    allowedOrigins: parseAllowedOrigins(),
  }),
});
