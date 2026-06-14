import { createNextAppRouterRoutes } from '@guidekit/server/next';

export const guidekitRoutes = createNextAppRouterRoutes({
  signingSecret: process.env.GUIDEKIT_SECRET!,
  createTokenOptions: () => ({
    llmApiKey: process.env.LLM_API_KEY!,
    sttApiKey: process.env.STT_API_KEY,
    ttsApiKey: process.env.TTS_API_KEY,
    expiresIn: '15m',
  }),
});
