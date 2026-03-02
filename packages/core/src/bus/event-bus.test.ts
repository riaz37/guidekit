import { describe, it, expect, vi } from 'vitest';
import { createEventBus, EventBus } from './index';

describe('EventBus', () => {
  // ---- Factory ------------------------------------------------------------

  it('creates an EventBus instance via createEventBus()', () => {
    const bus = createEventBus();
    expect(bus).toBeInstanceOf(EventBus);
  });

  // ---- on / emit ----------------------------------------------------------

  it('on() subscribes to specific events and receives typed payloads', () => {
    const bus = createEventBus();
    const handler = vi.fn();

    bus.on('dom:scan-complete', handler);
    const payload = { pageModel: { title: 'Test' }, durationMs: 42 };
    bus.emit('dom:scan-complete', payload);

    expect(handler).toHaveBeenCalledOnce();
    // The handler receives the payload as its first argument.
    expect(handler.mock.calls[0][0]).toEqual(payload);
  });

  it('emit() fires all handlers for the event', () => {
    const bus = createEventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();

    bus.on('dom:route-change', handler1);
    bus.on('dom:route-change', handler2);
    bus.on('dom:route-change', handler3);

    const payload = { from: '/a', to: '/b' };
    bus.emit('dom:route-change', payload);

    expect(handler1.mock.calls[0][0]).toEqual(payload);
    expect(handler2.mock.calls[0][0]).toEqual(payload);
    expect(handler3.mock.calls[0][0]).toEqual(payload);
  });

  // ---- Handler error isolation --------------------------------------------

  it('if one handler throws, other handlers still execute', () => {
    const bus = createEventBus();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handler1 = vi.fn();
    const throwingHandler = vi.fn(() => {
      throw new Error('boom');
    });
    const handler3 = vi.fn();

    bus.on('dom:route-change', handler1);
    bus.on('dom:route-change', throwingHandler);
    bus.on('dom:route-change', handler3);

    const payload = { from: '/', to: '/about' };
    bus.emit('dom:route-change', payload);

    expect(handler1).toHaveBeenCalledOnce();
    expect(throwingHandler).toHaveBeenCalledOnce();
    expect(handler3).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledOnce();

    errorSpy.mockRestore();
  });

  // ---- Namespace wildcards ------------------------------------------------

  it('namespace subscriptions: bus.on("dom:*", handler) fires for all dom: events', () => {
    const bus = createEventBus();
    const handler = vi.fn();

    bus.on('dom:*', handler);

    const scanPayload = { pageModel: {}, durationMs: 10 };
    bus.emit('dom:scan-complete', scanPayload);

    const routePayload = { from: '/a', to: '/b' };
    bus.emit('dom:route-change', routePayload);

    expect(handler).toHaveBeenCalledTimes(2);
    // Wildcard handlers receive (data, eventName)
    expect(handler).toHaveBeenNthCalledWith(1, scanPayload, 'dom:scan-complete');
    expect(handler).toHaveBeenNthCalledWith(2, routePayload, 'dom:route-change');
  });

  it('namespace wildcard does not fire for events in other namespaces', () => {
    const bus = createEventBus();
    const handler = vi.fn();

    bus.on('dom:*', handler);

    bus.emit('llm:response-start', { conversationId: 'c1' });

    expect(handler).not.toHaveBeenCalled();
  });

  // ---- onAny --------------------------------------------------------------

  it('onAny() receives all events with event name', () => {
    const bus = createEventBus();
    const handler = vi.fn();

    bus.onAny(handler);

    const scanPayload = { pageModel: {}, durationMs: 5 };
    bus.emit('dom:scan-complete', scanPayload);

    const errPayload = new Error('test');
    bus.emit('error', errPayload);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, scanPayload, 'dom:scan-complete');
    expect(handler).toHaveBeenNthCalledWith(2, errPayload, 'error');
  });

  // ---- once ---------------------------------------------------------------

  it('once() fires exactly once, then auto-unsubscribes', () => {
    const bus = createEventBus();
    const handler = vi.fn();

    bus.once('dom:route-change', handler);

    const payload = { from: '/x', to: '/y' };
    bus.emit('dom:route-change', payload);
    bus.emit('dom:route-change', payload);
    bus.emit('dom:route-change', payload);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('once() unsubscribe function cancels a not-yet-fired listener', () => {
    const bus = createEventBus();
    const handler = vi.fn();

    const unsub = bus.once('dom:route-change', handler);
    unsub();

    bus.emit('dom:route-change', { from: '/', to: '/z' });

    expect(handler).not.toHaveBeenCalled();
  });

  // ---- Unsubscribe --------------------------------------------------------

  it('unsubscribe function removes the handler', () => {
    const bus = createEventBus();
    const handler = vi.fn();

    const unsub = bus.on('dom:scan-complete', handler);
    unsub();

    bus.emit('dom:scan-complete', { pageModel: {}, durationMs: 0 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('calling unsubscribe twice is safe (idempotent)', () => {
    const bus = createEventBus();
    const handler = vi.fn();

    const unsub = bus.on('dom:scan-complete', handler);
    unsub();
    unsub(); // second call should not throw

    bus.emit('dom:scan-complete', { pageModel: {}, durationMs: 0 });
    expect(handler).not.toHaveBeenCalled();
  });

  // ---- removeAll ----------------------------------------------------------

  it('removeAll() clears all listeners', () => {
    const bus = createEventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const anyHandler = vi.fn();
    const wildcardHandler = vi.fn();

    bus.on('dom:scan-complete', handler1);
    bus.on('llm:response-start', handler2);
    bus.onAny(anyHandler);
    bus.on('dom:*', wildcardHandler);

    bus.removeAll();

    bus.emit('dom:scan-complete', { pageModel: {}, durationMs: 0 });
    bus.emit('llm:response-start', { conversationId: 'c1' });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
    expect(anyHandler).not.toHaveBeenCalled();
    expect(wildcardHandler).not.toHaveBeenCalled();
    expect(bus.listenerCount()).toBe(0);
  });

  // ---- listenerCount ------------------------------------------------------

  it('listenerCount() returns correct count per event', () => {
    const bus = createEventBus();

    bus.on('dom:scan-complete', () => {});
    bus.on('dom:scan-complete', () => {});
    bus.on('llm:response-start', () => {});

    expect(bus.listenerCount('dom:scan-complete')).toBe(2);
    expect(bus.listenerCount('llm:response-start')).toBe(1);
    expect(bus.listenerCount('dom:route-change')).toBe(0);
  });

  it('listenerCount() returns correct total count', () => {
    const bus = createEventBus();

    bus.on('dom:scan-complete', () => {});
    bus.on('llm:response-start', () => {});
    bus.on('dom:*', () => {});
    bus.onAny(() => {});

    // 1 (scan-complete) + 1 (response-start) + 1 (dom:*) + 1 (onAny) = 4
    expect(bus.listenerCount()).toBe(4);
  });

  it('listenerCount() decreases after unsubscribing', () => {
    const bus = createEventBus();

    const unsub1 = bus.on('dom:scan-complete', () => {});
    const unsub2 = bus.on('dom:scan-complete', () => {});

    expect(bus.listenerCount('dom:scan-complete')).toBe(2);

    unsub1();
    expect(bus.listenerCount('dom:scan-complete')).toBe(1);

    unsub2();
    expect(bus.listenerCount('dom:scan-complete')).toBe(0);
  });

  // ---- Snapshot iteration -------------------------------------------------

  it('handler that adds new handler during emit does not cause it to fire in same batch', () => {
    const bus = createEventBus();
    const laterHandler = vi.fn();

    bus.on('dom:scan-complete', () => {
      // Adding a new handler during emit — it should NOT fire in this batch
      bus.on('dom:scan-complete', laterHandler);
    });

    bus.emit('dom:scan-complete', { pageModel: {}, durationMs: 0 });

    expect(laterHandler).not.toHaveBeenCalled();

    // On the next emit the new handler SHOULD fire
    bus.emit('dom:scan-complete', { pageModel: {}, durationMs: 1 });
    expect(laterHandler).toHaveBeenCalledOnce();
  });

  // ---- Debug mode ---------------------------------------------------------

  it('debug mode logs emitted events', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const bus = createEventBus({ debug: true });
    const payload = { pageModel: {}, durationMs: 99 };
    bus.emit('dom:scan-complete', payload);

    expect(logSpy).toHaveBeenCalledWith(
      '[GuideKit:Bus]',
      'dom:scan-complete',
      payload,
    );

    logSpy.mockRestore();
  });

  it('debug mode is off by default', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const bus = createEventBus();
    bus.emit('dom:scan-complete', { pageModel: {}, durationMs: 0 });

    expect(logSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });

  // ---- Empty emit ---------------------------------------------------------

  it('empty emit (no listeners) does not throw', () => {
    const bus = createEventBus();

    expect(() => {
      bus.emit('dom:scan-complete', { pageModel: {}, durationMs: 0 });
    }).not.toThrow();
  });

  // ---- Registration order -------------------------------------------------

  it('multiple handlers on same event execute in registration order', () => {
    const bus = createEventBus();
    const callOrder: number[] = [];

    bus.on('dom:scan-complete', () => callOrder.push(1));
    bus.on('dom:scan-complete', () => callOrder.push(2));
    bus.on('dom:scan-complete', () => callOrder.push(3));

    bus.emit('dom:scan-complete', { pageModel: {}, durationMs: 0 });

    expect(callOrder).toEqual([1, 2, 3]);
  });

  // ---- Edge cases ---------------------------------------------------------

  it('handler that removes itself during emit does not affect other handlers', () => {
    const bus = createEventBus();
    const handler2 = vi.fn();
    const unsub = bus.on('dom:scan-complete', () => {
      unsub();
    });
    bus.on('dom:scan-complete', handler2);

    bus.emit('dom:scan-complete', { pageModel: {}, durationMs: 0 });

    expect(handler2).toHaveBeenCalledOnce();
  });

  it('onAny unsubscribe is idempotent', () => {
    const bus = createEventBus();
    const handler = vi.fn();

    const unsub = bus.onAny(handler);
    unsub();
    unsub(); // should not throw

    bus.emit('dom:scan-complete', { pageModel: {}, durationMs: 0 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('wildcard handler unsubscribe removes only that handler', () => {
    const bus = createEventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const unsub1 = bus.on('dom:*', handler1);
    bus.on('dom:*', handler2);

    unsub1();

    bus.emit('dom:scan-complete', { pageModel: {}, durationMs: 0 });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it('top-level error event (no namespace colon prefix) does not trigger wildcard', () => {
    const bus = createEventBus();
    const wildcardHandler = vi.fn();
    const exactHandler = vi.fn();

    // 'error' has no colon, so no namespace wildcard should match
    bus.on('dom:*', wildcardHandler);
    bus.on('error', exactHandler);

    bus.emit('error', new Error('fail'));

    expect(exactHandler).toHaveBeenCalledOnce();
    expect(wildcardHandler).not.toHaveBeenCalled();
  });
});
