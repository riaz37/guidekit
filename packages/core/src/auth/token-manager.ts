// ---------------------------------------------------------------------------
// GuideKit SDK – Client-side Token Manager
// ---------------------------------------------------------------------------
//
// Handles the full token lifecycle:
// - Fetch token from the developer's token endpoint on init
// - Auto-refresh at 80% of TTL
// - BroadcastChannel multi-tab coordination with leader election
// - localStorage fallback for browsers without BroadcastChannel
// - Emits auth events (token-refreshed, token-refresh-failed, token-expired)
// ---------------------------------------------------------------------------

import type { EventBus } from '../bus/index.js';
import { AuthenticationError, ErrorCodes } from '../errors/index.js';

const LOG_PREFIX = '[GuideKit:Auth]';
const REFRESH_THRESHOLD = 0.8; // Refresh at 80% of TTL
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 1_000;
const BC_CHANNEL_NAME = 'guidekit-token';
const LS_KEY_PREFIX = 'guidekit-token:';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenData {
  token: string;
  expiresAt: number; // Unix seconds
  expiresIn: number; // Seconds from issuance
  fetchedAt: number; // Date.now() when fetched
}

export interface TokenManagerOptions {
  tokenEndpoint: string;
  instanceId: string;
  bus: EventBus;
  debug?: boolean;
}

// ---------------------------------------------------------------------------
// TokenManager
// ---------------------------------------------------------------------------

export class TokenManager {
  private readonly endpoint: string;
  private readonly instanceId: string;
  private readonly bus: EventBus;
  private readonly debug: boolean;

  private _token: TokenData | null = null;
  private _refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private _isLeader = false;
  private _bc: BroadcastChannel | null = null;
  private _destroyed = false;

  constructor(options: TokenManagerOptions) {
    this.endpoint = options.tokenEndpoint;
    this.instanceId = options.instanceId;
    this.bus = options.bus;
    this.debug = options.debug ?? false;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Current token string, or null if not yet fetched. */
  get token(): string | null {
    return this._token?.token ?? null;
  }

  /** Current token data, or null if not yet fetched. */
  get tokenData(): TokenData | null {
    return this._token;
  }

  /** Whether this tab is the leader for token refresh. */
  get isLeader(): boolean {
    return this._isLeader;
  }

  /**
   * Initialize the token manager: elect leader, fetch initial token,
   * schedule auto-refresh.
   */
  async start(): Promise<void> {
    if (this._destroyed) return;

    this.setupBroadcastChannel();
    this.electLeader();

    // Try to load a cached token from localStorage first
    const cached = this.loadFromStorage();
    if (cached && !this.isExpired(cached)) {
      this._token = cached;
      this.log('Loaded cached token from localStorage');
      this.scheduleRefresh();
      return;
    }

    // Fetch a fresh token
    await this.fetchToken();
  }

  /**
   * Force a token refresh, regardless of TTL.
   */
  async refresh(): Promise<void> {
    await this.fetchToken();
  }

  /**
   * Clean up timers, BroadcastChannel, and release leader.
   */
  destroy(): void {
    this._destroyed = true;

    if (this._refreshTimer !== null) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }

    if (this._bc) {
      this._bc.close();
      this._bc = null;
    }

    this._token = null;
    this._isLeader = false;
  }

  // -------------------------------------------------------------------------
  // Token fetching
  // -------------------------------------------------------------------------

  private async fetchToken(attempt = 1): Promise<void> {
    if (this._destroyed) return;

    this.log(`Fetching token (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: this.instanceId }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        if (response.status === 401 || response.status === 403) {
          throw new AuthenticationError({
            code: ErrorCodes.AUTH_INVALID_KEY,
            message: `Token endpoint returned ${response.status}: ${body}`,
            suggestion: 'Check your tokenEndpoint URL and server authentication.',
          });
        }
        // Retryable server error
        throw new Error(`Token endpoint returned ${response.status}: ${body}`);
      }

      const data = await response.json() as {
        token?: string;
        expiresIn?: number;
        expiresAt?: number;
      };

      if (!data.token || typeof data.token !== 'string') {
        throw new AuthenticationError({
          code: ErrorCodes.AUTH_ENDPOINT_FAILED,
          message: 'Token endpoint response missing "token" field.',
          suggestion: 'Ensure your token endpoint returns { token, expiresIn, expiresAt }.',
        });
      }

      const tokenData: TokenData = {
        token: data.token,
        expiresAt: data.expiresAt ?? Math.floor(Date.now() / 1000) + (data.expiresIn ?? 900),
        expiresIn: data.expiresIn ?? 900,
        fetchedAt: Date.now(),
      };

      this._token = tokenData;
      this.saveToStorage(tokenData);
      this.broadcastToken(tokenData);
      this.scheduleRefresh();

      this.bus.emit('auth:token-refreshed', { expiresAt: tokenData.expiresAt });
      this.log(`Token fetched, expires at ${new Date(tokenData.expiresAt * 1000).toISOString()}`);
    } catch (error) {
      const remaining = MAX_RETRY_ATTEMPTS - attempt;

      if (remaining > 0 && !(error instanceof AuthenticationError)) {
        this.log(`Token fetch failed, retrying in ${RETRY_BASE_MS * attempt}ms`);
        this.bus.emit('auth:token-refresh-failed', {
          error: error instanceof Error ? error : new Error(String(error)),
          attemptsRemaining: remaining,
        });

        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_BASE_MS * attempt),
        );
        return this.fetchToken(attempt + 1);
      }

      // All retries exhausted
      this.bus.emit('auth:token-refresh-failed', {
        error: error instanceof Error ? error : new Error(String(error)),
        attemptsRemaining: 0,
      });

      if (error instanceof AuthenticationError) throw error;

      throw new AuthenticationError({
        code: ErrorCodes.AUTH_ENDPOINT_FAILED,
        message: `Failed to fetch token after ${MAX_RETRY_ATTEMPTS} attempts: ${error instanceof Error ? error.message : String(error)}`,
        suggestion: 'Check your tokenEndpoint URL and network connection.',
      });
    }
  }

  // -------------------------------------------------------------------------
  // Auto-refresh scheduling
  // -------------------------------------------------------------------------

  private scheduleRefresh(): void {
    if (this._destroyed || !this._token) return;

    // Clear existing timer
    if (this._refreshTimer !== null) {
      clearTimeout(this._refreshTimer);
    }

    const now = Date.now();
    const tokenAgeMs = now - this._token.fetchedAt;
    const ttlMs = this._token.expiresIn * 1000;
    const refreshAtMs = ttlMs * REFRESH_THRESHOLD;
    const delayMs = Math.max(0, refreshAtMs - tokenAgeMs);

    this.log(`Scheduling refresh in ${Math.round(delayMs / 1000)}s (80% of ${this._token.expiresIn}s TTL)`);

    this._refreshTimer = setTimeout(() => {
      if (this._destroyed) return;

      // Only the leader refreshes
      if (this._isLeader) {
        this.log('Leader performing scheduled refresh');
        this.fetchToken().catch((err) => {
          this.log(`Scheduled refresh failed: ${err}`);
        });
      } else {
        this.log('Not leader, skipping refresh (will receive via BroadcastChannel)');
        // Schedule another check in case we become leader
        this.scheduleExpiredCheck();
      }
    }, delayMs);
  }

  private scheduleExpiredCheck(): void {
    if (this._destroyed || !this._token) return;

    const now = Date.now();
    const expiresAtMs = this._token.expiresAt * 1000;
    const delayMs = Math.max(0, expiresAtMs - now);

    this._refreshTimer = setTimeout(() => {
      if (this._destroyed) return;
      if (this._token && this.isExpired(this._token)) {
        this.bus.emit('auth:token-expired', {} as Record<string, never>);
        // Try to refresh as last resort
        this.electLeader();
        if (this._isLeader) {
          this.fetchToken().catch(() => {});
        }
      }
    }, delayMs);
  }

  // -------------------------------------------------------------------------
  // BroadcastChannel (multi-tab coordination)
  // -------------------------------------------------------------------------

  private setupBroadcastChannel(): void {
    if (typeof BroadcastChannel === 'undefined') {
      // Fallback: always be leader if no BroadcastChannel
      this._isLeader = true;
      this.log('BroadcastChannel unavailable, acting as leader');
      return;
    }

    try {
      this._bc = new BroadcastChannel(`${BC_CHANNEL_NAME}:${this.instanceId}`);
      this._bc.onmessage = (event) => {
        const msg = event.data as { type: string; token?: TokenData; tabId?: string };

        if (msg.type === 'token-updated' && msg.token) {
          this.log('Received token from leader via BroadcastChannel');
          this._token = msg.token;
          this.saveToStorage(msg.token);
          this.scheduleRefresh();
          this.bus.emit('auth:token-refreshed', { expiresAt: msg.token.expiresAt });
        }

        if (msg.type === 'leader-election') {
          // Another tab is claiming leadership — yield if we're not already leader
          // or if their tabId is lexicographically lower (deterministic)
          if (this._isLeader && msg.tabId && msg.tabId < this._tabId) {
            this._isLeader = false;
            this.log('Yielded leadership to another tab');
          }
        }
      };
    } catch {
      this._isLeader = true;
      this.log('BroadcastChannel setup failed, acting as leader');
    }
  }

  private readonly _tabId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

  private electLeader(): void {
    // Simple leader election: broadcast our intent, wait for contestation
    // If no BroadcastChannel, we're always leader
    if (!this._bc) {
      this._isLeader = true;
      return;
    }

    this._isLeader = true;
    try {
      this._bc.postMessage({
        type: 'leader-election',
        tabId: this._tabId,
      });
    } catch {
      // Channel may be closed
    }

    this.log(`Elected as leader (tabId: ${this._tabId.slice(0, 8)}...)`);
  }

  private broadcastToken(tokenData: TokenData): void {
    if (!this._bc) return;
    try {
      this._bc.postMessage({
        type: 'token-updated',
        token: tokenData,
      });
    } catch {
      // Channel may be closed
    }
  }

  // -------------------------------------------------------------------------
  // localStorage fallback
  // -------------------------------------------------------------------------

  private get storageKey(): string {
    return `${LS_KEY_PREFIX}${this.instanceId}`;
  }

  private saveToStorage(data: TokenData): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
      }
    } catch {
      // localStorage may be full or unavailable (incognito, SSR)
    }
  }

  private loadFromStorage(): TokenData | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return null;
      return JSON.parse(raw) as TokenData;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private isExpired(data: TokenData): boolean {
    const nowSec = Math.floor(Date.now() / 1000);
    return nowSec >= data.expiresAt;
  }

  private log(message: string): void {
    if (this.debug) {
      console.debug(`${LOG_PREFIX} ${message}`);
    }
  }
}
