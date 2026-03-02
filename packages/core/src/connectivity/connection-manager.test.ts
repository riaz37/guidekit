import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectionManager, type QueuedMessage } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simulate the browser firing the "online" event on `window`.
 */
function fireOnlineEvent(): void {
  window.dispatchEvent(new Event('online'));
}

/**
 * Simulate the browser firing the "offline" event on `window`.
 */
function fireOfflineEvent(): void {
  window.dispatchEvent(new Event('offline'));
}

function makeMessage(overrides: Partial<QueuedMessage> = {}): QueuedMessage {
  return {
    content: overrides.content ?? 'hello',
    timestamp: overrides.timestamp ?? Date.now(),
    pageUrl: overrides.pageUrl ?? 'http://localhost/',
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ConnectionManager', () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();

    // Default: navigator reports online
    vi.stubGlobal('navigator', { ...navigator, onLine: true });

    // Spy on window event registration
    addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    // Stub fetch globally so pings can be controlled
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    // Stub location.href for queue draining
    Object.defineProperty(window, 'location', {
      value: { href: 'http://localhost/' },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ---- 1. Constructor defaults --------------------------------------------

  it('state defaults to "online" and is not running', () => {
    const cm = new ConnectionManager();
    expect(cm.state).toBe('online');
  });

  it('accepts healthEndpoint and debug options', () => {
    // Should not throw
    const cm = new ConnectionManager({
      healthEndpoint: 'https://example.com/health',
      debug: true,
    });
    expect(cm.state).toBe('online');
  });

  // ---- 2. start() lifecycle — registers browser event listeners ----------

  it('start() registers online and offline event listeners', () => {
    const cm = new ConnectionManager();
    cm.start();

    const onlineCall = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === 'online',
    );
    const offlineCall = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === 'offline',
    );

    expect(onlineCall).toBeDefined();
    expect(offlineCall).toBeDefined();

    cm.stop();
  });

  it('start() begins the periodic ping interval', () => {
    const cm = new ConnectionManager({ healthEndpoint: 'https://example.com/health' });
    cm.start();

    // The default state is "online" which has a 30s interval.
    // Advancing past that interval should trigger a fetch (ping).
    expect(fetch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);

    expect(fetch).toHaveBeenCalledTimes(1);

    cm.stop();
  });

  // ---- 3. stop() lifecycle — removes listeners, clears intervals ---------

  it('stop() removes online and offline event listeners', () => {
    const cm = new ConnectionManager();
    cm.start();
    cm.stop();

    const onlineRemoval = removeEventListenerSpy.mock.calls.find(
      (call) => call[0] === 'online',
    );
    const offlineRemoval = removeEventListenerSpy.mock.calls.find(
      (call) => call[0] === 'offline',
    );

    expect(onlineRemoval).toBeDefined();
    expect(offlineRemoval).toBeDefined();
  });

  it('stop() clears the ping timer so no further pings fire', () => {
    const cm = new ConnectionManager({ healthEndpoint: 'https://example.com/health' });
    cm.start();
    cm.stop();

    vi.advanceTimersByTime(60_000);
    expect(fetch).not.toHaveBeenCalled();
  });

  // ---- 4. Browser "online" event → emits state change if was offline -----

  it('browser "online" event transitions from offline to online', () => {
    const cb = vi.fn();
    const cm = new ConnectionManager();
    cm.onStateChange(cb);
    cm.start();

    // Force offline first
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    fireOfflineEvent();
    expect(cm.state).toBe('offline');

    // Now go back online
    vi.stubGlobal('navigator', { ...navigator, onLine: true });
    fireOnlineEvent();
    expect(cm.state).toBe('online');

    // Callback should have been called for each transition
    const onlineTransition = cb.mock.calls.find(
      (call) => call[0] === 'online' && call[1] === 'offline',
    );
    expect(onlineTransition).toBeDefined();

    cm.stop();
  });

  // ---- 5. Browser "offline" event → transitions to offline ---------------

  it('browser "offline" event transitions to offline state', () => {
    const cm = new ConnectionManager();
    cm.start();
    expect(cm.state).toBe('online');

    fireOfflineEvent();
    expect(cm.state).toBe('offline');

    cm.stop();
  });

  // ---- 6. Ping success → stays online ------------------------------------

  it('ping success with low latency keeps state as online', async () => {
    const cm = new ConnectionManager({ healthEndpoint: 'https://example.com/health' });
    cm.start();

    // Fast successful fetch
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null));

    // Advance to trigger the first ping (30s for online state)
    await vi.advanceTimersByTimeAsync(30_000);

    expect(cm.state).toBe('online');

    cm.stop();
  });

  // ---- 7. Ping failure → transitions to degraded -------------------------

  it('ping failure with navigator.onLine=true transitions to degraded', async () => {
    const cm = new ConnectionManager({ healthEndpoint: 'https://example.com/health' });
    cm.start();

    // Simulate a network error while browser still reports online
    vi.stubGlobal('navigator', { ...navigator, onLine: true });
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    await vi.advanceTimersByTimeAsync(30_000);

    expect(cm.state).toBe('degraded');

    cm.stop();
  });

  // ---- 8. Ping failure → offline when navigator.onLine is false ----------

  it('ping failure with navigator.onLine=false transitions to offline', async () => {
    const cm = new ConnectionManager({ healthEndpoint: 'https://example.com/health' });
    cm.start();

    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    await vi.advanceTimersByTimeAsync(30_000);

    expect(cm.state).toBe('offline');

    cm.stop();
  });

  // ---- 9. Full state cycle: online → degraded → offline → online ---------

  it('supports full state cycle: online → degraded → offline → online', async () => {
    const cb = vi.fn();
    const cm = new ConnectionManager({ healthEndpoint: 'https://example.com/health' });
    cm.onStateChange(cb);
    cm.start();

    expect(cm.state).toBe('online');

    // Step 1: Ping fails (navigator.onLine = true) → degraded
    vi.stubGlobal('navigator', { ...navigator, onLine: true });
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(cm.state).toBe('degraded');

    // Step 2: Browser goes fully offline
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    fireOfflineEvent();
    expect(cm.state).toBe('offline');

    // Step 3: Browser comes back online
    vi.stubGlobal('navigator', { ...navigator, onLine: true });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null));
    fireOnlineEvent();
    expect(cm.state).toBe('online');

    // Verify all transitions were recorded
    expect(cb).toHaveBeenCalledWith('degraded', 'online');
    expect(cb).toHaveBeenCalledWith('offline', 'degraded');
    expect(cb).toHaveBeenCalledWith('online', 'offline');

    cm.stop();
  });

  // ---- 10. queueMessage() stores up to MAX_QUEUE_SIZE --------------------

  it('queueMessage() stores messages up to the queue limit', () => {
    const cm = new ConnectionManager();

    for (let i = 0; i < 5; i++) {
      cm.queueMessage(makeMessage({ content: `msg-${i}` }));
    }

    const drained = cm.drainQueue();
    expect(drained).toHaveLength(5);
    expect(drained[0].content).toBe('msg-0');
    expect(drained[4].content).toBe('msg-4');
  });

  // ---- 11. Message queue cap: discards oldest when full ------------------

  it('queueMessage() discards the oldest message when the queue is full', () => {
    const cm = new ConnectionManager();

    // Fill to capacity
    for (let i = 0; i < 5; i++) {
      cm.queueMessage(makeMessage({ content: `msg-${i}` }));
    }

    // Push one more — oldest (msg-0) should be discarded
    cm.queueMessage(makeMessage({ content: 'msg-5' }));

    const drained = cm.drainQueue();
    expect(drained).toHaveLength(5);
    expect(drained[0].content).toBe('msg-1');
    expect(drained[4].content).toBe('msg-5');
  });

  // ---- 12. drainQueue() filters by URL -----------------------------------

  it('drainQueue() returns only messages matching the current page URL', () => {
    const cm = new ConnectionManager();

    cm.queueMessage(makeMessage({ content: 'same-page', pageUrl: 'http://localhost/' }));
    cm.queueMessage(makeMessage({ content: 'other-page', pageUrl: 'http://localhost/other' }));
    cm.queueMessage(makeMessage({ content: 'also-same', pageUrl: 'http://localhost/' }));

    // window.location.href is "http://localhost/"
    const drained = cm.drainQueue();

    expect(drained).toHaveLength(2);
    expect(drained[0].content).toBe('same-page');
    expect(drained[1].content).toBe('also-same');
  });

  it('drainQueue() empties the internal queue after draining', () => {
    const cm = new ConnectionManager();

    cm.queueMessage(makeMessage({ content: 'a' }));
    cm.queueMessage(makeMessage({ content: 'b' }));

    cm.drainQueue();
    const secondDrain = cm.drainQueue();

    expect(secondDrain).toHaveLength(0);
  });

  // ---- 13. onStateChange callback fires on transitions -------------------

  it('onStateChange() callback fires with (newState, previousState)', () => {
    const cb = vi.fn();
    const cm = new ConnectionManager();
    cm.onStateChange(cb);
    cm.start();

    fireOfflineEvent();

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith('offline', 'online');

    cm.stop();
  });

  it('onStateChange() returns an unsubscribe function', () => {
    const cb = vi.fn();
    const cm = new ConnectionManager();
    const unsub = cm.onStateChange(cb);
    cm.start();

    unsub();
    fireOfflineEvent();

    expect(cb).not.toHaveBeenCalled();

    cm.stop();
  });

  it('onStateChange() unsubscribe is idempotent', () => {
    const cb = vi.fn();
    const cm = new ConnectionManager();
    const unsub = cm.onStateChange(cb);

    // Calling twice should not throw
    unsub();
    expect(() => unsub()).not.toThrow();
  });

  // ---- 14. SSR guard: start() no-ops when window is undefined ------------

  it('start() is a no-op when window is undefined (SSR)', () => {
    const origWindow = globalThis.window;

    try {
      // @ts-expect-error -- simulating SSR by deleting window
      delete (globalThis as Record<string, unknown>).window;

      const cm = new ConnectionManager();
      // Should not throw even without window
      expect(() => cm.start()).not.toThrow();
      expect(() => cm.stop()).not.toThrow();
    } finally {
      globalThis.window = origWindow;
    }
  });

  // ---- 15. Idempotent start/stop -----------------------------------------

  it('calling start() twice does not double-register listeners', () => {
    const cm = new ConnectionManager();
    cm.start();
    cm.start(); // second call should be a no-op

    const onlineCalls = addEventListenerSpy.mock.calls.filter(
      (call) => call[0] === 'online',
    );
    expect(onlineCalls).toHaveLength(1);

    cm.stop();
  });

  it('calling stop() twice does not throw', () => {
    const cm = new ConnectionManager();
    cm.start();
    cm.stop();

    expect(() => cm.stop()).not.toThrow();
  });

  it('calling stop() without start() does not throw', () => {
    const cm = new ConnectionManager();
    expect(() => cm.stop()).not.toThrow();
  });

  // ---- Degraded state via high latency pings -----------------------------

  it('high latency pings transition state to degraded', async () => {
    const cm = new ConnectionManager({ healthEndpoint: 'https://example.com/health' });
    cm.start();

    // Simulate slow pings by advancing time between the fetch call and resolution
    // The ping measures Date.now() before and after fetch — with fake timers we
    // can make the elapsed time large by advancing inside the mock.
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      // Simulate 3 seconds of network latency
      vi.advanceTimersByTime(3_000);
      return new Response(null);
    });

    // Trigger 3 pings to fill the rolling window (ROLLING_WINDOW = 3)
    // First ping at 30s (online interval)
    await vi.advanceTimersByTimeAsync(30_000);
    // After degraded transition, interval drops to 5s
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(cm.state).toBe('degraded');

    cm.stop();
  });

  // ---- Subscriber error isolation ----------------------------------------

  it('a throwing subscriber does not prevent other subscribers from being notified', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const cb1 = vi.fn();
    const throwingCb = vi.fn(() => {
      throw new Error('subscriber boom');
    });
    const cb3 = vi.fn();

    const cm = new ConnectionManager();
    cm.onStateChange(cb1);
    cm.onStateChange(throwingCb);
    cm.onStateChange(cb3);
    cm.start();

    fireOfflineEvent();

    expect(cb1).toHaveBeenCalledOnce();
    expect(throwingCb).toHaveBeenCalledOnce();
    expect(cb3).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledOnce();

    cm.stop();
    errorSpy.mockRestore();
  });

  // ---- No health endpoint: relies on navigator.onLine --------------------

  it('without healthEndpoint, ping falls back to navigator.onLine', async () => {
    const cm = new ConnectionManager(); // no healthEndpoint
    cm.start();

    vi.stubGlobal('navigator', { ...navigator, onLine: false });

    // Trigger the ping timer (online = 30s)
    await vi.advanceTimersByTimeAsync(30_000);

    expect(cm.state).toBe('offline');

    cm.stop();
  });

  // ---- checkNow() -------------------------------------------------------

  it('checkNow() performs an immediate ping and returns the updated state', async () => {
    const cm = new ConnectionManager({ healthEndpoint: 'https://example.com/health' });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null));

    const state = await cm.checkNow();
    expect(state).toBe('online');
  });

  it('checkNow() returns offline when navigator.onLine is false', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    const cm = new ConnectionManager({ healthEndpoint: 'https://example.com/health' });

    const state = await cm.checkNow();
    expect(state).toBe('offline');
  });

  // ---- Same-state transition is suppressed --------------------------------

  it('transition to the same state does not fire subscriber callbacks', () => {
    const cb = vi.fn();
    const cm = new ConnectionManager();
    cm.onStateChange(cb);
    cm.start();

    // State is already 'online'; firing 'online' event should not trigger transition
    fireOnlineEvent();

    expect(cb).not.toHaveBeenCalled();

    cm.stop();
  });

  // ---- Offline event suspends pinging, online resumes --------------------

  it('offline event suspends pinging; online event resumes it', async () => {
    const cm = new ConnectionManager({ healthEndpoint: 'https://example.com/health' });
    cm.start();

    // Go offline — should clear ping timer
    fireOfflineEvent();
    expect(cm.state).toBe('offline');

    // Advance time well past any ping interval — no pings should fire
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).not.toHaveBeenCalled();

    // Go back online — should resume pinging
    vi.stubGlobal('navigator', { ...navigator, onLine: true });
    fireOnlineEvent();

    // Now advance to the next ping interval (online = 30s)
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledTimes(1);

    cm.stop();
  });
});
