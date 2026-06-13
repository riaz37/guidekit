/**
 * @module @guidekit/server/redis
 *
 * Redis-backed SessionStore for horizontal scaling.
 * Requires `ioredis` or compatible client at runtime.
 */

import type { ProviderKeys, SessionStore } from './session-store.js';

export interface RedisSessionStoreOptions {
  /** ioredis instance or connection URL. */
  redis: RedisLike;
  keyPrefix?: string;
  ttlSeconds?: number;
}

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, duration?: number): Promise<unknown>;
  del(key: string): Promise<number>;
  keys?(pattern: string): Promise<string[]>;
}

interface StoredEntry {
  keys: ProviderKeys;
  expiresAt: number;
}

export class RedisSessionStore implements SessionStore {
  private readonly redis: RedisLike;
  private readonly prefix: string;
  private readonly ttlSeconds: number;

  constructor(options: RedisSessionStoreOptions) {
    this.redis = options.redis;
    this.prefix = options.keyPrefix ?? 'guidekit:session:';
    this.ttlSeconds = options.ttlSeconds ?? 900;
  }

  private key(sessionId: string): string {
    return `${this.prefix}${sessionId}`;
  }

  get(_sessionId: string): ProviderKeys | undefined {
    throw new Error(
      'RedisSessionStore.get is async-only. Use getAsync() with an async proxy handler.',
    );
  }

  async getAsync(sessionId: string): Promise<ProviderKeys | undefined> {
    const raw = await this.redis.get(this.key(sessionId));
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as StoredEntry;
      if (parsed.expiresAt <= Math.floor(Date.now() / 1000)) {
        await this.redis.del(this.key(sessionId));
        return undefined;
      }
      return parsed.keys;
    } catch {
      return undefined;
    }
  }

  set(sessionId: string, keys: ProviderKeys, expiresAt: number): void {
    const payload: StoredEntry = { keys, expiresAt };
    void this.redis.set(
      this.key(sessionId),
      JSON.stringify(payload),
      'EX',
      this.ttlSeconds,
    );
  }

  delete(sessionId: string): boolean {
    void this.redis.del(this.key(sessionId));
    return true;
  }

  evictExpired(): void {
    // Redis TTL handles expiry; optional keys() sweep for custom deployments.
    if (!this.redis.keys) return;
    void this.redis.keys(`${this.prefix}*`).then(async (keys) => {
      const now = Math.floor(Date.now() / 1000);
      for (const key of keys) {
        const raw = await this.redis.get(key);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw) as StoredEntry;
          if (parsed.expiresAt <= now) await this.redis.del(key);
        } catch {
          await this.redis.del(key);
        }
      }
    });
  }
}
