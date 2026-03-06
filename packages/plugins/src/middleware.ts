import type { MiddlewareFunction } from '@guidekit/core';

/**
 * Koa-style async middleware pipeline.
 * Each middleware receives (ctx, next). Calling next() invokes the next
 * middleware; not calling it short-circuits the chain.
 */
export class MiddlewarePipeline<T> {
  private stack: MiddlewareFunction<T>[] = [];

  /** Add a middleware to the end of the stack. */
  use(fn: MiddlewareFunction<T>): void {
    this.stack.push(fn);
  }

  /** Remove a middleware from the stack. Returns true if found. */
  remove(fn: MiddlewareFunction<T>): boolean {
    const idx = this.stack.indexOf(fn);
    if (idx === -1) return false;
    this.stack.splice(idx, 1);
    return true;
  }

  /** Execute the middleware chain with the given context. */
  async execute(ctx: T): Promise<T> {
    const fns = this.stack;
    let index = -1;

    const dispatch = async (i: number): Promise<T> => {
      if (i <= index) {
        throw new Error('next() called multiple times');
      }
      index = i;
      if (i >= fns.length) return ctx;
      return await fns[i]!(ctx, () => dispatch(i + 1));
    };

    return dispatch(0);
  }

  /** Number of middlewares in the stack. */
  get length(): number {
    return this.stack.length;
  }

  /** Clear all middlewares. */
  clear(): void {
    this.stack.length = 0;
  }
}
