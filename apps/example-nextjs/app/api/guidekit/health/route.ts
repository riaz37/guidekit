import { createNextAppRouterRoutes } from '@guidekit/server/next';

const routes = createNextAppRouterRoutes({
  signingSecret: process.env.GUIDEKIT_SECRET!,
});

export const GET = routes.GET_health;
