// ---------------------------------------------------------------------------
// GuideKitCore lifecycle regression tests
// ---------------------------------------------------------------------------
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GuideKitCore } from './core.js';

describe('GuideKitCore lifecycle', () => {
  let core: GuideKitCore;

  beforeEach(() => {
    core = new GuideKitCore({
      instanceId: 'lifecycle-test',
      llm: { provider: 'gemini', apiKey: 'fake-key', model: 'gemini-2.0-flash' },
      options: {
        // Keep voice disabled so jsdom doesn't need Web Speech APIs.
        mode: 'text',
      },
    });
  });

  afterEach(async () => {
    await core.destroy().catch(() => {});
  });

  it('initializes, destroys, and re-initializes the same instance', async () => {
    await core.init();
    expect(core.isReady).toBe(true);

    await core.destroy();
    expect(core.isReady).toBe(false);

    // Regression: this used to throw "Cannot register resource ... manager is tearing_down"
    // because the ResourceManager was torn down and the same GuideKitCore instance
    // (reused by React StrictMode) tried to register into it.
    await core.init();
    expect(core.isReady).toBe(true);
  });

  it('waits for an in-flight destroy before re-initializing', async () => {
    await core.init();
    expect(core.isReady).toBe(true);

    // Start destroy but do not await it.
    const destroyPromise = core.destroy();
    expect(core.isReady).toBe(false);

    // While destroy is still running, call init() again (React StrictMode pattern).
    // init() should wait for the destroy to finish and then re-initialize cleanly.
    await core.init();
    expect(core.isReady).toBe(true);

    // Ensure the original destroy promise also resolves.
    await destroyPromise;
  });

  it('re-registers onError/onEvent bus listeners after re-initialization', async () => {
    const onError = vi.fn();
    const onEvent = vi.fn();

    core = new GuideKitCore({
      instanceId: 'lifecycle-test',
      llm: { provider: 'gemini', apiKey: 'fake-key', model: 'gemini-2.0-flash' },
      onError,
      onEvent,
      options: { mode: 'text' },
    });

    await core.init();
    await core.destroy();
    await core.init();

    // After re-init, the onEvent listener should be active again.
    core.bus.emit('voice:state-change', { from: 'idle', to: 'listening' });
    expect(onEvent).toHaveBeenCalled();
  });

  it('waits for an in-flight init before destroying', async () => {
    core = new GuideKitCore({
      instanceId: 'lifecycle-test',
      tokenEndpoint: '/api/guidekit/token',
      llm: { provider: 'gemini', apiKey: 'fake-key', model: 'gemini-2.0-flash' },
      options: { mode: 'text' },
    });

    let resolveFetch: ((value: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })),
    );

    // Start init but do not await it; it will block on the token endpoint.
    const initPromise = core.init();

    // Destroy while init is still in progress. This used to race and could
    // throw "Cannot register resource ... manager is tearing_down" because
    // destroy would tear down the ResourceManager while init was still trying
    // to register the token-manager.
    const destroyPromise = core.destroy();

    // Yield once so destroy's await of _initPromise is registered before we
    // resolve the fetch. Otherwise the fetch may resolve and init may complete
    // before destroy actually starts waiting.
    await Promise.resolve();

    // Let the token fetch resolve so init can finish, then destroy completes.
    resolveFetch?.(new Response(JSON.stringify({ token: 'fake-token' })));

    await destroyPromise;
    expect(core.isReady).toBe(false);

    // Reset fetch so the next init succeeds.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ token: 'fake-token' })))),
    );

    await core.init();
    expect(core.isReady).toBe(true);

    // The original init promise should also settle (either resolve or reject).
    await initPromise.catch(() => {});
  });
});
