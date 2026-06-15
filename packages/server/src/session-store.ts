/**
 * @module @guidekit/server/session-store
 *
 * Pluggable session key storage for provider API keys.
 */

export interface ProviderKeys {
  sttApiKey?: string;
  ttsApiKey?: string;
  llmApiKey?: string;
}

export interface SessionEntry {
  keys: ProviderKeys;
  /** Unix timestamp in seconds */
  expiresAt: number;
}

export interface SessionStore {
  get(sessionId: string): Promise<ProviderKeys | undefined>;
  set(sessionId: string, keys: ProviderKeys, expiresAt: number): Promise<void>;
  delete(sessionId: string): Promise<boolean>;
  evictExpired(): Promise<void>;
}

const EVICTION_INTERVAL_MS = 60_000;

const SHARED_STORE_KEY = Symbol.for('@guidekit/server/sharedSessionStore');

/** Process-wide store for Next.js dev (each route bundle may load session-store separately). */
export function getSharedSessionStore(): SessionStore {
  const globalStore = globalThis as typeof globalThis & {
    [SHARED_STORE_KEY]?: InMemorySessionStore;
  };
  if (!globalStore[SHARED_STORE_KEY]) {
    globalStore[SHARED_STORE_KEY] = new InMemorySessionStore();
  }
  return globalStore[SHARED_STORE_KEY];
}

/** In-memory session store (single process). */
export class InMemorySessionStore implements SessionStore {
  private store = new Map<string, SessionEntry>();
  private lastEvictionTime = 0;

  async get(sessionId: string): Promise<ProviderKeys | undefined> {
    await this.evictExpired();
    const entry = this.store.get(sessionId);
    if (!entry) return undefined;
    if (entry.expiresAt <= Math.floor(Date.now() / 1000)) {
      this.store.delete(sessionId);
      return undefined;
    }
    return entry.keys;
  }

  async set(sessionId: string, keys: ProviderKeys, expiresAt: number): Promise<void> {
    await this.evictExpired();
    this.store.set(sessionId, { keys, expiresAt });
  }

  async delete(sessionId: string): Promise<boolean> {
    return this.store.delete(sessionId);
  }

  async evictExpired(): Promise<void> {
    const now = Date.now();
    if (now - this.lastEvictionTime < EVICTION_INTERVAL_MS) return;
    this.lastEvictionTime = now;
    const nowSec = Math.floor(now / 1000);
    for (const [id, entry] of this.store) {
      if (entry.expiresAt <= nowSec) {
        this.store.delete(id);
      }
    }
  }
}

/** Default session store — shared across module reloads in the same Node process. */
export const defaultSessionStore: SessionStore = getSharedSessionStore();
