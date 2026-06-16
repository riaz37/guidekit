import { createRequire } from 'node:module';
import type { SessionStore } from '@guidekit/server';
import { getSharedSessionStore } from '@guidekit/server/next';
import { RedisSessionStore, type RedisLike } from '@guidekit/server/redis';

const require = createRequire(import.meta.url);

/**
 * Process-wide session store for the example app.
 *
 * - Default: in-memory (single instance, local dev)
 * - Production: set REDIS_URL and install `ioredis` for horizontal scaling
 */
function buildSessionStore(): SessionStore {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return getSharedSessionStore();
  }

  try {
    // Optional peer — webpack must not statically resolve unless installed.
    const redisPkg = ['iored', 'is'].join('');
    const Redis = require(redisPkg) as new (url: string) => RedisLike;
    return new RedisSessionStore({ redis: new Redis(redisUrl) });
  } catch {
    console.warn(
      '[GuideKit example] REDIS_URL is set but ioredis is not installed. Falling back to in-memory session store.',
    );
    return getSharedSessionStore();
  }
}

export const guidekitSessionStore: SessionStore = buildSessionStore();
