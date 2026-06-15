/**
 * @module @guidekit/server/adapters/next
 */

import type { GuideKitHandlerOptions } from '../handler.js';
import { createGuideKitHandler } from '../handler.js';

export { getSharedSessionStore } from '../session-store.js';

export interface NextGuideKitRoutes {
  POST_token: (request: Request) => Promise<Response>;
  POST_llm: (request: Request) => Promise<Response>;
  POST_stt: (request: Request) => Promise<Response>;
  POST_tts: (request: Request) => Promise<Response>;
  GET_health: () => Promise<Response>;
}

export function createNextAppRouterRoutes(
  options: GuideKitHandlerOptions,
): NextGuideKitRoutes {
  const handler = createGuideKitHandler(options);

  return {
    POST_token: (request: Request) => handler(request, 'token'),
    POST_llm: (request: Request) => handler(request, 'llm'),
    POST_stt: (request: Request) => handler(request, 'stt'),
    POST_tts: (request: Request) => handler(request, 'tts'),
    GET_health: () => handler(new Request('http://localhost/health'), 'health'),
  };
}
