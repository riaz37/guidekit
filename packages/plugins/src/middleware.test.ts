import { describe, it, expect } from 'vitest';
import { MiddlewarePipeline } from './middleware.js';

describe('MiddlewarePipeline', () => {
  it('returns ctx unchanged for empty pipeline', async () => {
    const pipeline = new MiddlewarePipeline<{ value: number }>();
    const result = await pipeline.execute({ value: 42 });
    expect(result.value).toBe(42);
  });

  it('runs middlewares in insertion order', async () => {
    const pipeline = new MiddlewarePipeline<{ value: number }>();
    pipeline.use(async (ctx, next) => {
      ctx.value += 1;
      return await next();
    });
    pipeline.use(async (ctx, next) => {
      ctx.value *= 2;
      return await next();
    });
    const result = await pipeline.execute({ value: 1 });
    expect(result.value).toBe(4); // (1+1)*2
  });

  it('short-circuits when next() is not called', async () => {
    const pipeline = new MiddlewarePipeline<{ value: number }>();
    pipeline.use(async (ctx) => {
      ctx.value = 99;
      return ctx; // no next()
    });
    pipeline.use(async (ctx, next) => {
      ctx.value = -1; // should never run
      return await next();
    });
    const result = await pipeline.execute({ value: 0 });
    expect(result.value).toBe(99);
  });

  it('throws when next() is called multiple times', async () => {
    const pipeline = new MiddlewarePipeline<{ value: number }>();
    pipeline.use(async (ctx, next) => {
      await next();
      return await next(); // second call
    });
    await expect(pipeline.execute({ value: 0 })).rejects.toThrow(
      'next() called multiple times',
    );
  });

  it('handles sync middleware return', async () => {
    const pipeline = new MiddlewarePipeline<{ value: string }>();
    pipeline.use((ctx, next) => {
      ctx.value += '-sync';
      return next();
    });
    const result = await pipeline.execute({ value: 'start' });
    expect(result.value).toBe('start-sync');
  });

  it('use() adds and length reflects count', () => {
    const pipeline = new MiddlewarePipeline<object>();
    expect(pipeline.length).toBe(0);
    const fn = async (_ctx: object, next: () => Promise<object>) => next();
    pipeline.use(fn);
    expect(pipeline.length).toBe(1);
  });

  it('remove() removes a middleware and returns true', () => {
    const pipeline = new MiddlewarePipeline<object>();
    const fn = async (_ctx: object, next: () => Promise<object>) => next();
    pipeline.use(fn);
    expect(pipeline.remove(fn)).toBe(true);
    expect(pipeline.length).toBe(0);
  });

  it('remove() returns false for unknown middleware', () => {
    const pipeline = new MiddlewarePipeline<object>();
    const fn = async (_ctx: object, next: () => Promise<object>) => next();
    expect(pipeline.remove(fn)).toBe(false);
  });

  it('clear() empties the stack', () => {
    const pipeline = new MiddlewarePipeline<object>();
    const fn = async (_ctx: object, next: () => Promise<object>) => next();
    pipeline.use(fn);
    pipeline.use(fn);
    pipeline.clear();
    expect(pipeline.length).toBe(0);
  });

  it('supports downstream-then-upstream (Koa onion) pattern', async () => {
    const order: string[] = [];
    const pipeline = new MiddlewarePipeline<{ order: string[] }>();
    pipeline.use(async (ctx, next) => {
      ctx.order.push('a-down');
      const result = await next();
      ctx.order.push('a-up');
      return result;
    });
    pipeline.use(async (ctx, next) => {
      ctx.order.push('b-down');
      const result = await next();
      ctx.order.push('b-up');
      return result;
    });
    const result = await pipeline.execute({ order });
    expect(result.order).toEqual(['a-down', 'b-down', 'b-up', 'a-up']);
  });
});
