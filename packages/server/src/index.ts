/**
 * @guidekit/server — public API
 */

export {
  createSessionToken,
  validateSessionToken,
  getSessionKeys,
  clearSessionKeys,
  generateSecret,
} from './auth.js';

export type {
  TokenPayload,
  CreateSessionTokenOptions,
  CreateSessionTokenResult,
  ValidateSessionTokenResult,
  ValidateSessionTokenOptions,
} from './auth.js';

export {
  InMemorySessionStore,
  defaultSessionStore,
  getSharedSessionStore,
} from './session-store.js';

export type { ProviderKeys, SessionStore, SessionEntry } from './session-store.js';

export { handleLLMProxy } from './proxy/llm.js';
export type { LLMProxyOptions, LLMProxyRequestBody } from './proxy/llm.js';

export { handleSiteSearch } from './proxy/site-search.js';
export type {
  SiteKnowledgeDocument,
  SiteSearchOptions,
  SiteSearchRequestBody,
  SiteSearchResult,
} from './proxy/site-search.js';

export { handleVoiceProxy } from './proxy/voice.js';
export type { VoiceProxyOptions, VoiceProxyKind } from './proxy/voice.js';

export { createRateLimiter } from './middleware/rate-limit.js';
export type { RateLimitOptions } from './middleware/rate-limit.js';

export { createGuideKitHandler } from './handler.js';
export type { GuideKitHandlerOptions, GuideKitRoute } from './handler.js';

export { createNextAppRouterRoutes } from './adapters/next.js';
export type { NextGuideKitRoutes } from './adapters/next.js';

export { RedisSessionStore } from './redis-session-store.js';
export type { RedisSessionStoreOptions, RedisLike } from './redis-session-store.js';
