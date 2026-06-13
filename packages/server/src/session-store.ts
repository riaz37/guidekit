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
  get(sessionId: string): ProviderKeys | undefined;
  set(sessionId: string, keys: ProviderKeys, expiresAt: number): void;
  delete(sessionId: string): boolean;
  evictExpired(): void;
}

const EVICTION_INTERVAL_MS = 60_000;

/** In-memory session store (single process). */
export class InMemorySessionStore implements SessionStore {
  private store = new Map<string, SessionEntry>();
  private lastEvictionTime = 0;

  get(sessionId: string): ProviderKeys | undefined {
    this.evictExpired();
    const entry = this.store.get(sessionId);
    if (!entry) return undefined;
    if (entry.expiresAt <= Math.floor(Date.now() / 1000)) {
      this.store.delete(sessionId);
      return undefined;
    }
    return entry.keys;
  }

  set(sessionId: string, keys: ProviderKeys, expiresAt: number): void {
    this.evictExpired();
    this.store.set(sessionId, { keys, expiresAt });
  }

  delete(sessionId: string): boolean {
    return this.store.delete(sessionId);
  }

  evictExpired(): void {
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

/** Default process-wide session store. */
export const defaultSessionStore = new InMemorySessionStore();
