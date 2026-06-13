import { createNextAppRouterRoutes } from '@guidekit/server/next';

const routes = createNextAppRouterRoutes({
  signingSecret: process.env.GUIDEKIT_SECRET!,
  createTokenOptions: () => ({
    llmApiKey: process.env.LLM_API_KEY!,
    sttApiKey: process.env.STT_API_KEY,
    ttsApiKey: process.env.TTS_API_KEY,
    expiresIn: '15m',
  }),
  llmProxy: {
    defaultProvider: 'gemini',
    defaultModel: 'gemini-2.5-flash',
  },
});

export const POST = routes.POST_llm;
