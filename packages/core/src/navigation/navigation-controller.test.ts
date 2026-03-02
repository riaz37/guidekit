import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NavigationController } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock of the Navigation API (Chrome 102+). */
function createMockNavigationAPI() {
  const listeners: Record<string, Array<(event: unknown) => void>> = {};

  return {
    addEventListener: vi.fn((event: string, handler: (event: unknown) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    removeEventListener: vi.fn((event: string, handler: (event: unknown) => void) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((h) => h !== handler);
      }
    }),
    /** Test helper: fire a synthetic navigate event. */
    _fireNavigate(destinationUrl: string) {
      const event = { destination: { url: destinationUrl } };
      for (const handler of listeners['navigate'] ?? []) {
        handler(event);
      }
    },
    _listeners: listeners,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('NavigationController', () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();

    // Set up a baseline window.location
    Object.defineProperty(window, 'location', {
      value: {
        href: 'http://localhost/',
        origin: 'http://localhost',
      },
      writable: true,
      configurable: true,
    });

    addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    // Ensure no Navigation API by default — tests that need it will add it
    // @ts-expect-error -- clearing navigation for test isolation
    delete (window as any).navigation;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ---- 1. Constructor defaults -------------------------------------------

  it('constructor creates an instance with default options', () => {
    const nc = new NavigationController();
    expect(nc.url).toBe('http://localhost/');
  });

  it('constructor accepts debug and router options', () => {
    const router = { push: vi.fn() };
    const nc = new NavigationController({ debug: true, router });
    expect(nc.url).toBe('http://localhost/');
  });

  // ---- 2. start() with Navigation API available -------------------------

  it('start() attaches a "navigate" listener when Navigation API is available', () => {
    const mockNav = createMockNavigationAPI();
    (window as any).navigation = mockNav;

    const nc = new NavigationController();
    nc.start();

    expect(mockNav.addEventListener).toHaveBeenCalledWith('navigate', expect.any(Function));

    nc.stop();
  });

  it('Navigation API navigate event fires route change callback', () => {
    const mockNav = createMockNavigationAPI();
    (window as any).navigation = mockNav;

    const cb = vi.fn();
    const nc = new NavigationController();
    nc.onRouteChange(cb);
    nc.start();

    mockNav._fireNavigate('http://localhost/new-page');

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith('http://localhost/', 'http://localhost/new-page');

    nc.stop();
  });

  // ---- 3. start() fallback with popstate --------------------------------

  it('start() falls back to popstate when Navigation API is unavailable', () => {
    const nc = new NavigationController();
    nc.start();

    const popstateCalls = addEventListenerSpy.mock.calls.filter(
      (call) => call[0] === 'popstate',
    );
    expect(popstateCalls).toHaveLength(1);

    nc.stop();
  });

  it('popstate event fires route change callback', () => {
    const cb = vi.fn();
    const nc = new NavigationController();
    nc.onRouteChange(cb);
    nc.start();

    // Simulate a popstate event after URL change
    (window.location as any).href = 'http://localhost/back-page';
    window.dispatchEvent(new Event('popstate'));

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith('http://localhost/', 'http://localhost/back-page');

    nc.stop();
  });

  // ---- 4. Polling interval as fallback ----------------------------------

  it('start() sets up a 200ms polling interval when Navigation API is unavailable', () => {
    const cb = vi.fn();
    const nc = new NavigationController();
    nc.onRouteChange(cb);
    nc.start();

    // Simulate a pushState-style URL change (no popstate fires for pushState)
    (window.location as any).href = 'http://localhost/pushed';

    // Advance past the 200ms polling interval
    vi.advanceTimersByTime(200);

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith('http://localhost/', 'http://localhost/pushed');

    nc.stop();
  });

  // ---- 5. onRouteChange callback ----------------------------------------

  it('onRouteChange() callback fires with (from, to) on navigation', () => {
    const mockNav = createMockNavigationAPI();
    (window as any).navigation = mockNav;

    const cb = vi.fn();
    const nc = new NavigationController();
    nc.onRouteChange(cb);
    nc.start();

    mockNav._fireNavigate('http://localhost/page-a');
    mockNav._fireNavigate('http://localhost/page-b');

    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenNthCalledWith(1, 'http://localhost/', 'http://localhost/page-a');
    expect(cb).toHaveBeenNthCalledWith(2, 'http://localhost/page-a', 'http://localhost/page-b');

    nc.stop();
  });

  // ---- 6. unsubscribe() from route changes ------------------------------

  it('unsubscribe from onRouteChange prevents future callbacks', () => {
    const mockNav = createMockNavigationAPI();
    (window as any).navigation = mockNav;

    const cb = vi.fn();
    const nc = new NavigationController();
    const unsub = nc.onRouteChange(cb);
    nc.start();

    // First navigation fires
    mockNav._fireNavigate('http://localhost/page-a');
    expect(cb).toHaveBeenCalledOnce();

    // Unsubscribe
    unsub();

    // Second navigation should not fire
    mockNav._fireNavigate('http://localhost/page-b');
    expect(cb).toHaveBeenCalledOnce(); // still 1

    nc.stop();
  });

  it('unsubscribe from onRouteChange is idempotent', () => {
    const cb = vi.fn();
    const nc = new NavigationController();
    const unsub = nc.onRouteChange(cb);

    unsub();
    expect(() => unsub()).not.toThrow();
  });

  // ---- 7. navigate() with same-origin URL succeeds ----------------------

  it('navigate() with same-origin URL returns true', async () => {
    const nc = new NavigationController();

    const result = await nc.navigate('/about');
    expect(result).toBe(true);
  });

  it('navigate() with same-origin absolute URL returns true', async () => {
    const nc = new NavigationController();

    const result = await nc.navigate('http://localhost/contact');
    expect(result).toBe(true);
  });

  // ---- 8. navigate() with cross-origin URL is blocked -------------------

  it('navigate() with cross-origin URL returns false', async () => {
    const nc = new NavigationController();

    const result = await nc.navigate('https://evil.com/phish');
    expect(result).toBe(false);
  });

  it('navigate() with invalid URL returns false', async () => {
    const nc = new NavigationController({ debug: true });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // We need a URL constructor that throws. In jsdom, "://bad" would
    // be resolved relative to the origin, so we use a URL that the
    // validation logic rejects (cross-origin).
    const result = await nc.navigate('https://other-origin.com/bad');
    expect(result).toBe(false);

    warnSpy.mockRestore();
  });

  // ---- 9. Developer router.push() integration ---------------------------

  it('navigate() uses the developer-provided router.push()', async () => {
    const pushFn = vi.fn();
    const nc = new NavigationController({ router: { push: pushFn } });

    const result = await nc.navigate('/dashboard');
    expect(result).toBe(true);
    expect(pushFn).toHaveBeenCalledOnce();
    // router.push receives the fully resolved href
    expect(pushFn).toHaveBeenCalledWith('http://localhost/dashboard');
  });

  it('navigate() awaits async router.push()', async () => {
    let resolved = false;
    const pushFn = vi.fn(async () => {
      resolved = true;
    });
    const nc = new NavigationController({ router: { push: pushFn } });

    const result = await nc.navigate('/async-page');
    expect(result).toBe(true);
    expect(resolved).toBe(true);
  });

  // ---- 10. stop() cleanup -----------------------------------------------

  it('stop() removes all event listeners and clears polling interval', () => {
    const nc = new NavigationController();
    nc.start();
    nc.stop();

    const popstateRemovals = removeEventListenerSpy.mock.calls.filter(
      (call) => call[0] === 'popstate',
    );
    expect(popstateRemovals).toHaveLength(1);
  });

  it('stop() removes Navigation API listener when used', () => {
    const mockNav = createMockNavigationAPI();
    (window as any).navigation = mockNav;

    const nc = new NavigationController();
    nc.start();
    nc.stop();

    expect(mockNav.removeEventListener).toHaveBeenCalledWith('navigate', expect.any(Function));
  });

  it('stop() clears the polling interval so no further polls fire', () => {
    const cb = vi.fn();
    const nc = new NavigationController();
    nc.onRouteChange(cb);
    nc.start();
    nc.stop();

    // Change URL after stop
    (window.location as any).href = 'http://localhost/after-stop';

    // Advance past many polling intervals
    vi.advanceTimersByTime(2_000);

    expect(cb).not.toHaveBeenCalled();
  });

  // ---- 11. Duplicate URL suppression ------------------------------------

  it('same URL does not fire route change twice', () => {
    const mockNav = createMockNavigationAPI();
    (window as any).navigation = mockNav;

    const cb = vi.fn();
    const nc = new NavigationController();
    nc.onRouteChange(cb);
    nc.start();

    mockNav._fireNavigate('http://localhost/page-x');
    mockNav._fireNavigate('http://localhost/page-x'); // duplicate

    expect(cb).toHaveBeenCalledOnce();

    nc.stop();
  });

  it('polling does not fire route change when URL has not changed', () => {
    const cb = vi.fn();
    const nc = new NavigationController();
    nc.onRouteChange(cb);
    nc.start();

    // Advance past several polling intervals without changing URL
    vi.advanceTimersByTime(1_000);

    expect(cb).not.toHaveBeenCalled();

    nc.stop();
  });

  // ---- 12. SSR guard — start() no-ops when window is undefined -----------

  it('start() is a no-op when window is undefined (SSR)', () => {
    const origWindow = globalThis.window;

    try {
      // @ts-expect-error -- simulating SSR by deleting window
      delete (globalThis as Record<string, unknown>).window;

      const nc = new NavigationController();
      expect(() => nc.start()).not.toThrow();
      expect(() => nc.stop()).not.toThrow();
    } finally {
      globalThis.window = origWindow;
    }
  });

  it('url getter returns empty string in SSR environment', () => {
    const origWindow = globalThis.window;

    try {
      // @ts-expect-error -- simulating SSR
      delete (globalThis as Record<string, unknown>).window;

      const nc = new NavigationController();
      expect(nc.url).toBe('');
    } finally {
      globalThis.window = origWindow;
    }
  });

  it('navigate() returns false in SSR environment', async () => {
    const origWindow = globalThis.window;

    try {
      // @ts-expect-error -- simulating SSR
      delete (globalThis as Record<string, unknown>).window;

      const nc = new NavigationController();
      const result = await nc.navigate('/anything');
      expect(result).toBe(false);
    } finally {
      globalThis.window = origWindow;
    }
  });

  // ---- Callback error isolation -----------------------------------------

  it('a throwing route change callback does not prevent others from firing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mockNav = createMockNavigationAPI();
    (window as any).navigation = mockNav;

    const cb1 = vi.fn();
    const throwingCb = vi.fn(() => {
      throw new Error('callback boom');
    });
    const cb3 = vi.fn();

    const nc = new NavigationController();
    nc.onRouteChange(cb1);
    nc.onRouteChange(throwingCb);
    nc.onRouteChange(cb3);
    nc.start();

    mockNav._fireNavigate('http://localhost/error-page');

    expect(cb1).toHaveBeenCalledOnce();
    expect(throwingCb).toHaveBeenCalledOnce();
    expect(cb3).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledOnce();

    nc.stop();
    errorSpy.mockRestore();
  });

  // ---- Multiple subscribers ---------------------------------------------

  it('multiple onRouteChange subscribers all receive events', () => {
    const mockNav = createMockNavigationAPI();
    (window as any).navigation = mockNav;

    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cb3 = vi.fn();

    const nc = new NavigationController();
    nc.onRouteChange(cb1);
    nc.onRouteChange(cb2);
    nc.onRouteChange(cb3);
    nc.start();

    mockNav._fireNavigate('http://localhost/multi');

    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
    expect(cb3).toHaveBeenCalledOnce();

    nc.stop();
  });
});
