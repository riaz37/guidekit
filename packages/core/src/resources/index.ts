// ---------------------------------------------------------------------------
// GuideKit SDK – Resource Lifecycle Manager
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[GuideKit:Resources]';

/** Timeout in milliseconds for each resource cleanup operation. */
const CLEANUP_TIMEOUT_MS = 2_000;

// ---------------------------------------------------------------------------
// Resource interface
// ---------------------------------------------------------------------------

/**
 * A disposable resource that the SDK tracks for deterministic cleanup.
 * Each resource has a unique name and a cleanup function that may be async.
 */
export interface Resource {
  name: string;
  cleanup: () => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// ResourceManager
// ---------------------------------------------------------------------------

/** Lifecycle states for a ResourceManager instance. */
export type ResourceManagerState =
  | 'initializing'
  | 'ready'
  | 'tearing_down'
  | 'torn_down';

/**
 * Manages the lifecycle of SDK resources (AbortControllers, event listeners,
 * WebSocket connections, etc.) and ensures deterministic cleanup on unmount.
 *
 * Resources are cleaned up sequentially — order matters because later
 * resources may depend on earlier ones still being alive during their own
 * cleanup phase.
 */
export class ResourceManager {
  readonly instanceId: string;

  private _state: ResourceManagerState = 'initializing';
  private readonly _resources: Map<string, Resource> = new Map();
  private _destroyPromise: Promise<void> | null = null;
  private _destroyCancelled = false;

  constructor(instanceId?: string) {
    this.instanceId = instanceId ?? generateId();
    debug(`Created ResourceManager "${this.instanceId}"`);
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  /** Current lifecycle state. */
  get state(): ResourceManagerState {
    return this._state;
  }

  /** Number of currently registered resources. */
  get resourceCount(): number {
    return this._resources.size;
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Register a resource for cleanup tracking.
   *
   * @throws If the manager has already been torn down.
   */
  register(resource: Resource): void {
    if (this._state === 'torn_down') {
      throw new Error(
        `${LOG_PREFIX} Cannot register resource "${resource.name}" — manager is torn down`,
      );
    }

    if (this._resources.has(resource.name)) {
      debug(
        `Replacing existing resource "${resource.name}" in "${this.instanceId}"`,
      );
    }

    this._resources.set(resource.name, resource);
    debug(
      `Registered "${resource.name}" in "${this.instanceId}" (total: ${this._resources.size})`,
    );
  }

  /**
   * Unregister a specific resource by name without invoking its cleanup.
   */
  unregister(name: string): void {
    const deleted = this._resources.delete(name);
    if (deleted) {
      debug(
        `Unregistered "${name}" from "${this.instanceId}" (total: ${this._resources.size})`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // AbortController helper
  // -------------------------------------------------------------------------

  /**
   * Create a tracked AbortController. On destroy, its `abort()` method will
   * be called automatically.
   */
  createAbortController(name: string): AbortController {
    const controller = new AbortController();

    this.register({
      name,
      cleanup: () => {
        if (!controller.signal.aborted) {
          controller.abort();
        }
      },
    });

    return controller;
  }

  // -------------------------------------------------------------------------
  // Lifecycle transitions
  // -------------------------------------------------------------------------

  /** Transition from `initializing` to `ready`. */
  markReady(): void {
    if (this._state === 'initializing') {
      this._state = 'ready';
      debug(`"${this.instanceId}" is now ready`);
    }
  }

  /**
   * Destroy all registered resources sequentially.
   *
   * Each resource gets up to {@link CLEANUP_TIMEOUT_MS}ms to complete.
   * If cleanup exceeds the timeout a warning is logged and the manager
   * proceeds to the next resource.
   *
   * After all resources are processed the state transitions to `torn_down`.
   * Calling `destroy()` multiple times returns the same promise.
   */
  async destroy(): Promise<void> {
    // Idempotent — return existing promise if already running / finished.
    if (this._destroyPromise) {
      return this._destroyPromise;
    }

    this._state = 'tearing_down';
    this._destroyCancelled = false;

    debug(
      `Destroying "${this.instanceId}" (${this._resources.size} resource(s))`,
    );

    this._destroyPromise = this._performDestroy();
    return this._destroyPromise;
  }

  /**
   * Cancel a pending destroy, transitioning back to `ready`.
   *
   * This exists to support React 18 StrictMode which unmounts then
   * immediately re-mounts components. If the re-mount arrives while
   * teardown is still in progress, cancelling prevents resource loss.
   *
   * @returns `true` if teardown was pending and has been cancelled.
   *          `false` if already torn down or not currently tearing down.
   */
  cancelDestroy(): boolean {
    if (this._state !== 'tearing_down') {
      return false;
    }

    debug(`Cancelling destroy for "${this.instanceId}"`);
    this._destroyCancelled = true;
    this._state = 'ready';
    this._destroyPromise = null;
    return true;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /** Sequential cleanup with per-resource timeout. */
  private async _performDestroy(): Promise<void> {
    // Snapshot the resource names so we iterate a stable list.
    const names = Array.from(this._resources.keys());

    for (const name of names) {
      // If cancelDestroy() was called mid-teardown, bail out early.
      if (this._destroyCancelled) {
        debug(
          `Destroy cancelled mid-teardown for "${this.instanceId}" — stopping cleanup`,
        );
        return;
      }

      const resource = this._resources.get(name);
      if (!resource) {
        continue;
      }

      try {
        /**
         * Cleanup timeout: logs warning but resolves promise regardless.
         * Resources may leak if cleanup takes longer than the timeout period.
         */
        await withTimeout(resource.cleanup(), CLEANUP_TIMEOUT_MS, () => {
          console.warn(
            `${LOG_PREFIX} Cleanup timeout for "${name}" (${CLEANUP_TIMEOUT_MS}ms)`,
          );
        });
      } catch (err) {
        console.warn(
          `${LOG_PREFIX} Cleanup error for "${name}":`,
          err,
        );
      }

      this._resources.delete(name);
    }

    // Only transition to torn_down if we were not cancelled.
    if (!this._destroyCancelled) {
      this._state = 'torn_down';
      debug(`"${this.instanceId}" is now torn down`);
    }
  }
}

// ---------------------------------------------------------------------------
// SingletonGuard – ref-counted singleton map
// ---------------------------------------------------------------------------

interface GuardEntry {
  manager: ResourceManager;
  refCount: number;
  pendingDestroyTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Ref-counted singleton guard keyed by `instanceId`.
 *
 * - `acquire()` increments the ref count (or creates the manager).
 * - `release()` decrements the ref count. When it reaches 0 a
 *   `setTimeout(0)` is scheduled to allow React StrictMode re-mount to
 *   reclaim the instance before it is destroyed.
 * - If a mount arrives during `TEARING_DOWN`, the teardown is cancelled
 *   and the manager transitions back to `READY`.
 */
export class SingletonGuard {
  private static readonly _entries: Map<string, GuardEntry> = new Map();

  /**
   * Acquire (or create) a ResourceManager for the given instanceId.
   *
   * @param instanceId Unique identifier for the singleton slot.
   * @param factory    Called to create a fresh ResourceManager when none
   *                   exists or the previous one has been torn down.
   */
  static acquire(
    instanceId: string,
    factory: () => ResourceManager,
  ): ResourceManager {
    const existing = SingletonGuard._entries.get(instanceId);

    if (existing) {
      // Cancel any pending deferred destruction.
      if (existing.pendingDestroyTimer !== null) {
        clearTimeout(existing.pendingDestroyTimer);
        existing.pendingDestroyTimer = null;
        debug(`Cleared pending destroy timer for "${instanceId}"`);
      }

      // If the manager is mid-teardown, cancel it.
      if (existing.manager.state === 'tearing_down') {
        const cancelled = existing.manager.cancelDestroy();
        if (cancelled) {
          debug(
            `Re-acquired "${instanceId}" — cancelled in-flight teardown`,
          );
        }
      }

      // If the previous manager was fully torn down, replace it.
      if (existing.manager.state === 'torn_down') {
        debug(
          `Previous manager for "${instanceId}" is torn down — creating new one`,
        );
        const manager = factory();
        SingletonGuard._entries.set(instanceId, {
          manager,
          refCount: 1,
          pendingDestroyTimer: null,
        });
        return manager;
      }

      existing.refCount += 1;
      debug(
        `Acquired "${instanceId}" (refCount: ${existing.refCount})`,
      );
      return existing.manager;
    }

    // First acquisition — create a new entry.
    const manager = factory();
    SingletonGuard._entries.set(instanceId, {
      manager,
      refCount: 1,
      pendingDestroyTimer: null,
    });
    debug(`Created new singleton for "${instanceId}"`);
    return manager;
  }

  /**
   * Release a reference to the manager. When the ref count drops to 0 a
   * `setTimeout(0)` delay is introduced before destruction so that React
   * StrictMode's synchronous re-mount can reclaim the instance.
   */
  static release(instanceId: string): void {
    const entry = SingletonGuard._entries.get(instanceId);
    if (!entry) {
      debug(`Release called for unknown instanceId "${instanceId}"`);
      return;
    }

    entry.refCount = Math.max(0, entry.refCount - 1);
    debug(`Released "${instanceId}" (refCount: ${entry.refCount})`);

    if (entry.refCount === 0) {
      // Defer destruction so StrictMode re-mount can reclaim.
      entry.pendingDestroyTimer = setTimeout(() => {
        entry.pendingDestroyTimer = null;

        // Double-check nobody re-acquired in the meantime.
        if (entry.refCount > 0) {
          return;
        }

        debug(`Destroying singleton "${instanceId}" (refCount is 0)`);
        entry.manager.destroy().then(() => {
          // Only remove from the map if it is still the same entry and
          // the manager successfully tore down.
          if (
            SingletonGuard._entries.get(instanceId) === entry &&
            entry.manager.state === 'torn_down'
          ) {
            SingletonGuard._entries.delete(instanceId);
            debug(`Removed singleton entry for "${instanceId}"`);
          }
        });
      }, 0);
    }
  }

  /**
   * Retrieve a manager by instanceId without affecting the ref count.
   * Returns `undefined` if no manager exists for the given id.
   */
  static get(instanceId: string): ResourceManager | undefined {
    return SingletonGuard._entries.get(instanceId)?.manager;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Race a (possibly async) operation against a timeout.
 * If the timeout wins, `onTimeout` is called and the function resolves
 * (it does **not** reject — the next resource should still be processed).
 */
function withTimeout(
  work: void | Promise<void>,
  ms: number,
  onTimeout: () => void,
): Promise<void> {
  // Synchronous cleanup — no timeout needed.
  if (!(work instanceof Promise)) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        onTimeout();
        resolve();
      }
    }, ms);

    work.then(
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      },
      (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          // Re-throw so the caller's catch block can log it.
          // We wrap in a rejected promise to keep the signature clean.
          resolve(Promise.reject(err));
        }
      },
    );
  });
}

/** Simple random ID generator (no crypto dependency required). */
function generateId(): string {
  return `gk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Conditional debug logging — only logs when globalThis has a truthy `__GUIDEKIT_DEBUG__` flag. */
function debug(...args: unknown[]): void {
  if (
    typeof globalThis !== 'undefined' &&
    (globalThis as Record<string, unknown>).__GUIDEKIT_DEBUG__
  ) {
    console.debug(LOG_PREFIX, ...args);
  }
}
