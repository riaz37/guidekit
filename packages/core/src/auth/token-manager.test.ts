/**
 * TokenManager – client-side token lifecycle tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TokenManager } from './token-manager.js';
import { createEventBus } from '../bus/index.js';
import type { EventBus } from '../bus/index.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock localStorage
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTokenResponse(expiresIn = 900) {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      token: 'test-jwt-token',
      expiresIn,
      expiresAt,
    }),
    text: async () => '',
  } as unknown as Response;
}

function createManager(bus?: EventBus, opts?: Partial<{ debug: boolean; instanceId: string }>) {
  return new TokenManager({
    tokenEndpoint: '/api/guidekit/token',
    instanceId: opts?.instanceId ?? 'test',
    bus: bus ?? createEventBus(),
    debug: opts?.debug ?? false,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TokenManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
    storage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---- Constructor & initial state ----------------------------------------

  describe('initial state', () => {
    it('starts with no token', () => {
      const tm = createManager();
      expect(tm.token).toBeNull();
      expect(tm.tokenData).toBeNull();
      tm.destroy();
    });

    it('isLeader defaults to false before start()', () => {
      const tm = createManager();
      expect(tm.isLeader).toBe(false);
      tm.destroy();
    });
  });

  // ---- start() & token fetch ---------------------------------------------

  describe('start()', () => {
    it('fetches a token from the endpoint', async () => {
      mockFetch.mockResolvedValueOnce(makeTokenResponse());
      const tm = createManager();

      await tm.start();

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/guidekit/token',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(tm.token).toBe('test-jwt-token');
      tm.destroy();
    });

    it('emits auth:token-refreshed on successful fetch', async () => {
      mockFetch.mockResolvedValueOnce(makeTokenResponse());
      const bus = createEventBus();
      const handler = vi.fn();
      bus.on('auth:token-refreshed', handler);

      const tm = createManager(bus);
      await tm.start();

      expect(handler).toHaveBeenCalledOnce();
      // EventBus invokeSafe passes (data, eventName) to all handlers
      expect(handler.mock.calls[0][0]).toMatchObject({
        expiresAt: expect.any(Number),
      });
      tm.destroy();
    });

    it('saves token to localStorage', async () => {
      mockFetch.mockResolvedValueOnce(makeTokenResponse());
      const tm = createManager();

      await tm.start();

      const stored = storage.get('guidekit-token:test');
      expect(stored).toBeDefined();
      const parsed = JSON.parse(stored!);
      expect(parsed.token).toBe('test-jwt-token');
      tm.destroy();
    });

    it('loads cached token from localStorage on start if not expired', async () => {
      const cached = {
        token: 'cached-jwt',
        expiresAt: Math.floor(Date.now() / 1000) + 600,
        expiresIn: 900,
        fetchedAt: Date.now() - 300_000, // 5 min ago
      };
      storage.set('guidekit-token:test', JSON.stringify(cached));

      const tm = createManager();
      await tm.start();

      // Should NOT have called fetch
      expect(mockFetch).not.toHaveBeenCalled();
      expect(tm.token).toBe('cached-jwt');
      tm.destroy();
    });

    it('ignores expired cached token and fetches fresh', async () => {
      const cached = {
        token: 'expired-jwt',
        expiresAt: Math.floor(Date.now() / 1000) - 10, // expired
        expiresIn: 900,
        fetchedAt: Date.now() - 1_000_000,
      };
      storage.set('guidekit-token:test', JSON.stringify(cached));
      mockFetch.mockResolvedValueOnce(makeTokenResponse());

      const tm = createManager();
      await tm.start();

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(tm.token).toBe('test-jwt-token');
      tm.destroy();
    });
  });

  // ---- Error handling & retries ------------------------------------------

  describe('error handling', () => {
    it('retries on non-auth errors up to 3 times', async () => {
      const networkError = new Error('Network failed');
      mockFetch
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce(makeTokenResponse());

      const bus = createEventBus();
      const failHandler = vi.fn();
      bus.on('auth:token-refresh-failed', failHandler);

      const tm = createManager(bus);

      // Start — first two fail, third succeeds. Uses setTimeout internally.
      const startPromise = tm.start();

      // Advance past retry delays
      await vi.advanceTimersByTimeAsync(1_000); // retry 1 delay
      await vi.advanceTimersByTimeAsync(2_000); // retry 2 delay

      await startPromise;

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(failHandler).toHaveBeenCalledTimes(2);
      expect(tm.token).toBe('test-jwt-token');
      tm.destroy();
    });

    it('throws AuthenticationError after all retries exhausted', async () => {
      mockFetch.mockRejectedValue(new Error('Network failed'));

      const tm = createManager();

      // Eagerly attach the catch handler before advancing timers
      let caughtError: Error | null = null;
      const startPromise = tm.start().catch((e) => { caughtError = e; });

      // Advance past all retry delays
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(3_000);

      await startPromise;
      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toContain('Failed to fetch token');
      tm.destroy();
    });

    it('throws on HTTP 401 immediately without retry', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      } as unknown as Response);

      const tm = createManager();
      await expect(tm.start()).rejects.toThrow('Token endpoint returned 401');
      // AuthenticationError is not retried
      expect(mockFetch).toHaveBeenCalledOnce();
      tm.destroy();
    });

    it('emits auth:token-refresh-failed with attemptsRemaining', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as unknown as Response);

      const bus = createEventBus();
      const failEvents: Array<{ attemptsRemaining: number }> = [];
      bus.on('auth:token-refresh-failed', (data) => {
        failEvents.push({ attemptsRemaining: data.attemptsRemaining });
      });

      const tm = createManager(bus);
      const startPromise = tm.start().catch(() => {});

      // Advance past all retry delays
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(3_000);

      await startPromise;

      expect(failEvents).toHaveLength(3);
      expect(failEvents[0].attemptsRemaining).toBe(2);
      expect(failEvents[1].attemptsRemaining).toBe(1);
      expect(failEvents[2].attemptsRemaining).toBe(0);
      tm.destroy();
    });

    it('handles missing token field in response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ notAToken: true }),
        text: async () => '',
      } as unknown as Response);

      const tm = createManager();
      let caughtError: Error | null = null;
      const startPromise = tm.start().catch((e) => { caughtError = e; });
      await vi.advanceTimersByTimeAsync(10_000);
      await startPromise;
      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toContain('missing "token" field');
      tm.destroy();
    });
  });

  // ---- Auto-refresh at 80% TTL ------------------------------------------

  describe('auto-refresh', () => {
    it('schedules refresh at 80% of TTL', async () => {
      const expiresIn = 100; // 100 seconds
      mockFetch
        .mockResolvedValueOnce(makeTokenResponse(expiresIn))
        .mockResolvedValueOnce(makeTokenResponse(expiresIn));

      const bus = createEventBus();
      const handler = vi.fn();
      bus.on('auth:token-refreshed', handler);

      const tm = createManager(bus);
      await tm.start();

      expect(handler).toHaveBeenCalledTimes(1); // initial fetch

      // Advance to 80% of 100s = 80s = 80_000ms
      await vi.advanceTimersByTimeAsync(80_000);

      expect(handler).toHaveBeenCalledTimes(2); // refresh triggered
      expect(mockFetch).toHaveBeenCalledTimes(2);
      tm.destroy();
    });
  });

  // ---- destroy() ---------------------------------------------------------

  describe('destroy()', () => {
    it('clears the token and timers', async () => {
      mockFetch.mockResolvedValueOnce(makeTokenResponse());
      const tm = createManager();
      await tm.start();

      expect(tm.token).not.toBeNull();
      tm.destroy();
      expect(tm.token).toBeNull();
    });

    it('does not fetch after destroy', async () => {
      mockFetch.mockResolvedValue(makeTokenResponse(100));
      const tm = createManager();
      await tm.start();

      const callsBefore = mockFetch.mock.calls.length;
      tm.destroy();

      // Advance past what would be the refresh time (80s for 100s TTL)
      await vi.advanceTimersByTimeAsync(200_000);

      // No additional fetch calls after destroy
      expect(mockFetch.mock.calls.length).toBe(callsBefore);
    });
  });

  // ---- refresh() ---------------------------------------------------------

  describe('refresh()', () => {
    it('forces a token refresh', async () => {
      mockFetch
        .mockResolvedValueOnce(makeTokenResponse())
        .mockResolvedValueOnce(makeTokenResponse());

      const tm = createManager();
      await tm.start();

      expect(mockFetch).toHaveBeenCalledOnce();

      await tm.refresh();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      tm.destroy();
    });
  });

  // ---- Leader election ---------------------------------------------------

  describe('leader election', () => {
    it('becomes leader when BroadcastChannel is unavailable', async () => {
      // BroadcastChannel is undefined in Node/test env
      mockFetch.mockResolvedValueOnce(makeTokenResponse());
      const tm = createManager();
      await tm.start();

      expect(tm.isLeader).toBe(true);
      tm.destroy();
    });
  });

  // ---- Instance isolation ------------------------------------------------

  describe('instance isolation', () => {
    it('uses instanceId in localStorage key', async () => {
      mockFetch.mockResolvedValueOnce(makeTokenResponse());
      const tmA = createManager(undefined, { instanceId: 'app-a' });
      await tmA.start();

      expect(storage.has('guidekit-token:app-a')).toBe(true);
      expect(storage.has('guidekit-token:app-b')).toBe(false);
      tmA.destroy();
    });

    it('separate instances use separate storage keys', async () => {
      mockFetch
        .mockResolvedValueOnce(makeTokenResponse())
        .mockResolvedValueOnce(makeTokenResponse());

      const tmA = createManager(undefined, { instanceId: 'iso-a' });
      const tmB = createManager(undefined, { instanceId: 'iso-b' });

      await tmA.start();
      await tmB.start();

      expect(storage.has('guidekit-token:iso-a')).toBe(true);
      expect(storage.has('guidekit-token:iso-b')).toBe(true);

      tmA.destroy();
      tmB.destroy();
    });
  });
});
