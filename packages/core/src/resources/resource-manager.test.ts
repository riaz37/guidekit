import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResourceManager, SingletonGuard } from './index.js';
import type { Resource } from './index.js';

/**
 * Flush all pending microtasks (Promise callbacks, etc.) by chaining a
 * sequence of `await Promise.resolve()` calls. This is needed because
 * vitest fake timers do not automatically flush the microtask queue.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// ResourceManager
// ---------------------------------------------------------------------------

describe('ResourceManager', () => {
  let manager: ResourceManager;

  beforeEach(() => {
    manager = new ResourceManager('test-rm');
  });

  // ---- State transitions --------------------------------------------------

  it('starts in "initializing" state', () => {
    expect(manager.state).toBe('initializing');
  });

  it('markReady() transitions to "ready" state', () => {
    manager.markReady();
    expect(manager.state).toBe('ready');
  });

  it('markReady() is a no-op when not in "initializing" state', () => {
    manager.markReady();
    expect(manager.state).toBe('ready');

    // Call again -- should stay "ready", not throw
    manager.markReady();
    expect(manager.state).toBe('ready');
  });

  // ---- Registration -------------------------------------------------------

  it('register() adds a resource', () => {
    const resource: Resource = { name: 'r1', cleanup: vi.fn() };
    manager.register(resource);
    expect(manager.resourceCount).toBe(1);
  });

  it('register() replaces a resource with the same name', () => {
    const r1: Resource = { name: 'dup', cleanup: vi.fn() };
    const r2: Resource = { name: 'dup', cleanup: vi.fn() };
    manager.register(r1);
    manager.register(r2);
    expect(manager.resourceCount).toBe(1);
  });

  it('register() throws when state is "torn_down"', async () => {
    manager.markReady();
    await manager.destroy();

    expect(() =>
      manager.register({ name: 'late', cleanup: vi.fn() }),
    ).toThrow(/torn down/);
  });

  // ---- Unregistration -----------------------------------------------------

  it('unregister() removes a resource without calling cleanup', () => {
    const cleanup = vi.fn();
    manager.register({ name: 'r1', cleanup });
    expect(manager.resourceCount).toBe(1);

    manager.unregister('r1');
    expect(manager.resourceCount).toBe(0);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('unregister() is safe for unknown names', () => {
    expect(() => manager.unregister('nonexistent')).not.toThrow();
  });

  // ---- AbortController helper ---------------------------------------------

  it('createAbortController() returns an AbortController and registers it', () => {
    const controller = manager.createAbortController('fetch-ctrl');
    expect(controller).toBeInstanceOf(AbortController);
    expect(controller.signal.aborted).toBe(false);
    expect(manager.resourceCount).toBe(1);
  });

  it('createAbortController() aborts the signal on destroy', async () => {
    const controller = manager.createAbortController('fetch-ctrl');
    manager.markReady();
    await manager.destroy();
    expect(controller.signal.aborted).toBe(true);
  });

  // ---- destroy() ----------------------------------------------------------

  it('destroy() calls cleanup on all resources sequentially', async () => {
    const order: string[] = [];
    manager.register({
      name: 'first',
      cleanup: () => {
        order.push('first');
      },
    });
    manager.register({
      name: 'second',
      cleanup: () => {
        order.push('second');
      },
    });

    manager.markReady();
    await manager.destroy();

    expect(order).toEqual(['first', 'second']);
  });

  it('destroy() handles async cleanup', async () => {
    const cleaned = vi.fn();
    manager.register({
      name: 'async-resource',
      cleanup: async () => {
        await Promise.resolve();
        cleaned();
      },
    });

    manager.markReady();
    await manager.destroy();

    expect(cleaned).toHaveBeenCalledOnce();
  });

  it('destroy() logs warning when cleanup exceeds 2s timeout', async () => {
    vi.useFakeTimers();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    manager.register({
      name: 'slow-resource',
      cleanup: () =>
        new Promise<void>(() => {
          // Never resolves -- simulates a stalled cleanup
        }),
    });

    manager.markReady();
    const destroyPromise = manager.destroy();

    // Advance past the 2000ms timeout
    vi.advanceTimersByTime(2_100);

    // Flush microtasks so the timeout callback resolves the promise
    await flushMicrotasks();

    await destroyPromise;

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Cleanup timeout'),
    );

    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('destroy() transitions to "torn_down"', async () => {
    manager.markReady();
    await manager.destroy();
    expect(manager.state).toBe('torn_down');
  });

  it('destroy() is idempotent — calling it twice returns resolved promises', async () => {
    manager.markReady();
    const p1 = manager.destroy();
    const p2 = manager.destroy();

    // Both calls should resolve successfully
    await expect(p1).resolves.toBeUndefined();
    await expect(p2).resolves.toBeUndefined();

    // State should be torn_down after both resolve
    expect(manager.state).toBe('torn_down');
  });

  it('destroy() removes all resources', async () => {
    manager.register({ name: 'a', cleanup: vi.fn() });
    manager.register({ name: 'b', cleanup: vi.fn() });
    manager.markReady();
    await manager.destroy();
    expect(manager.resourceCount).toBe(0);
  });

  it('destroy() continues to next resource when cleanup throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const secondCleanup = vi.fn();
    manager.register({
      name: 'failing',
      cleanup: () => {
        throw new Error('boom');
      },
    });
    manager.register({ name: 'after-fail', cleanup: secondCleanup });

    manager.markReady();
    await manager.destroy();

    expect(secondCleanup).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // ---- cancelDestroy() ----------------------------------------------------

  it('cancelDestroy() returns true when tearing down and transitions back to "ready"', () => {
    vi.useFakeTimers();

    manager.register({
      name: 'slow',
      cleanup: () => new Promise<void>(() => {}), // never resolves
    });

    manager.markReady();
    // Begin but do not await destroy so we stay in "tearing_down"
    void manager.destroy();

    expect(manager.state).toBe('tearing_down');
    const result = manager.cancelDestroy();
    expect(result).toBe(true);
    expect(manager.state).toBe('ready');

    vi.useRealTimers();
  });

  it('cancelDestroy() returns false when already torn down', async () => {
    manager.markReady();
    await manager.destroy();
    expect(manager.state).toBe('torn_down');

    const result = manager.cancelDestroy();
    expect(result).toBe(false);
  });

  it('cancelDestroy() returns false when in "initializing" state', () => {
    expect(manager.cancelDestroy()).toBe(false);
  });

  it('cancelDestroy() returns false when in "ready" state', () => {
    manager.markReady();
    expect(manager.cancelDestroy()).toBe(false);
  });

  // ---- resourceCount ------------------------------------------------------

  it('resourceCount returns correct count', () => {
    expect(manager.resourceCount).toBe(0);

    manager.register({ name: 'a', cleanup: vi.fn() });
    expect(manager.resourceCount).toBe(1);

    manager.register({ name: 'b', cleanup: vi.fn() });
    expect(manager.resourceCount).toBe(2);

    manager.unregister('a');
    expect(manager.resourceCount).toBe(1);
  });

  // ---- instanceId ---------------------------------------------------------

  it('uses provided instanceId', () => {
    expect(manager.instanceId).toBe('test-rm');
  });

  it('generates an instanceId when none is provided', () => {
    const auto = new ResourceManager();
    expect(auto.instanceId).toMatch(/^gk_/);
  });
});

// ---------------------------------------------------------------------------
// SingletonGuard
// ---------------------------------------------------------------------------

describe('SingletonGuard', () => {
  // Use a unique prefix per test to avoid cross-test contamination
  // from the static _entries map.
  let instanceCounter = 0;
  let INSTANCE_ID: string;

  /** Factory that returns a fresh ResourceManager and tracks calls. */
  const createFactory = () => {
    const calls: ResourceManager[] = [];
    const factory = () => {
      const rm = new ResourceManager(INSTANCE_ID);
      rm.markReady();
      calls.push(rm);
      return rm;
    };
    return { factory, calls };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    instanceCounter += 1;
    INSTANCE_ID = `sg-test-${instanceCounter}`;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('acquire() creates a new ResourceManager on first call', () => {
    const { factory, calls } = createFactory();
    const mgr = SingletonGuard.acquire(INSTANCE_ID, factory);
    expect(mgr).toBeInstanceOf(ResourceManager);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(mgr);
  });

  it('acquire() returns the same instance on subsequent calls (ref counting)', () => {
    const { factory, calls } = createFactory();

    const mgr1 = SingletonGuard.acquire(INSTANCE_ID, factory);
    const mgr2 = SingletonGuard.acquire(INSTANCE_ID, factory);

    expect(mgr1).toBe(mgr2);
    // Factory should only have been invoked once
    expect(calls).toHaveLength(1);
  });

  it('release() does NOT destroy immediately (setTimeout(0) delay)', () => {
    const { factory } = createFactory();
    const mgr = SingletonGuard.acquire(INSTANCE_ID, factory);

    SingletonGuard.release(INSTANCE_ID);

    // Immediately after release, the manager should still be alive
    expect(mgr.state).not.toBe('torn_down');
    expect(mgr.state).not.toBe('tearing_down');
  });

  it('after release + timeout, manager is destroyed', async () => {
    const { factory } = createFactory();
    const mgr = SingletonGuard.acquire(INSTANCE_ID, factory);

    SingletonGuard.release(INSTANCE_ID);

    // Flush the setTimeout(0) to trigger the deferred destroy
    vi.advanceTimersByTime(1);

    // Allow the async destroy() and its .then() to resolve
    await flushMicrotasks();

    expect(mgr.state).toBe('torn_down');
  });

  it('acquire during teardown cancels the teardown', () => {
    const { factory } = createFactory();
    const mgr = SingletonGuard.acquire(INSTANCE_ID, factory);

    // Register a slow resource so destroy stays in "tearing_down"
    mgr.register({
      name: 'slow',
      cleanup: () => new Promise<void>(() => {}), // never resolves
    });

    SingletonGuard.release(INSTANCE_ID);

    // Flush the deferred setTimeout(0) -- this triggers destroy()
    vi.advanceTimersByTime(1);

    // The destroy() is called and transitions to "tearing_down"
    // but the slow resource's cleanup never resolves.
    expect(mgr.state).toBe('tearing_down');

    // Re-acquire during teardown
    const mgr2 = SingletonGuard.acquire(INSTANCE_ID, factory);

    // cancelDestroy should have brought it back to "ready"
    expect(mgr2).toBe(mgr);
    expect(mgr.state).toBe('ready');
  });

  it('get() returns the manager without affecting ref count', () => {
    const { factory } = createFactory();

    // Before any acquisition, get returns undefined
    expect(SingletonGuard.get(INSTANCE_ID)).toBeUndefined();

    const mgr = SingletonGuard.acquire(INSTANCE_ID, factory);
    const peek = SingletonGuard.get(INSTANCE_ID);

    expect(peek).toBe(mgr);

    // Release the single acquire -- if get() had bumped the ref count
    // this single release would not trigger the deferred destroy timer
    SingletonGuard.release(INSTANCE_ID);

    // Flush the deferred timeout -- a destroy should be scheduled,
    // proving get() did not increment the ref count
    vi.advanceTimersByTime(1);

    // The manager should now be tearing down or torn down, not still ready.
    // This proves that get() did not add a reference.
    expect(mgr.state).not.toBe('ready');
  });

  it('acquire after full teardown creates a new manager', async () => {
    const { factory, calls } = createFactory();
    const mgr1 = SingletonGuard.acquire(INSTANCE_ID, factory);
    SingletonGuard.release(INSTANCE_ID);

    // Flush deferred destroy
    vi.advanceTimersByTime(1);

    // Allow async destroy chain to resolve
    await flushMicrotasks();

    expect(mgr1.state).toBe('torn_down');

    // Acquire again -- should get a brand-new manager
    const mgr2 = SingletonGuard.acquire(INSTANCE_ID, factory);
    expect(mgr2).not.toBe(mgr1);
    expect(calls).toHaveLength(2);
  });

  it('multiple acquires require the same number of releases', async () => {
    const { factory } = createFactory();

    SingletonGuard.acquire(INSTANCE_ID, factory);
    SingletonGuard.acquire(INSTANCE_ID, factory);
    SingletonGuard.acquire(INSTANCE_ID, factory);

    const mgr = SingletonGuard.get(INSTANCE_ID)!;

    // Release 1 of 3 -- no destroy yet (refCount > 0)
    SingletonGuard.release(INSTANCE_ID);
    vi.advanceTimersByTime(1);
    expect(mgr.state).not.toBe('torn_down');

    // Release 2 of 3
    SingletonGuard.release(INSTANCE_ID);
    vi.advanceTimersByTime(1);
    expect(mgr.state).not.toBe('torn_down');

    // Release 3 of 3 -- this should trigger deferred destroy
    SingletonGuard.release(INSTANCE_ID);
    vi.advanceTimersByTime(1);

    // Allow async destroy chain
    await flushMicrotasks();

    expect(mgr.state).toBe('torn_down');
  });

  it('release() is safe for unknown instanceId', () => {
    expect(() => SingletonGuard.release('unknown-id')).not.toThrow();
  });
});
