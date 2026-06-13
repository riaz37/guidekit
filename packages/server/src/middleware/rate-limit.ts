/**
 * @module @guidekit/server/middleware/rate-limit
 *
 * Sliding-window rate limiter keyed by sessionId and client IP.
 */

export interface RateLimitOptions {
  /** Window size in milliseconds. Default: 60_000 (1 minute). */
  windowMs?: number;
  /** Max requests per window per key. Default: 60. */
  maxRequests?: number;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}

function rateLimitKey(sessionId: string | undefined, ip: string): string {
  return sessionId ? `session:${sessionId}` : `ip:${ip}`;
}

export function createRateLimiter(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const maxRequests = options.maxRequests ?? 60;
  const windows = new Map<string, WindowEntry>();

  function prune(now: number): void {
    if (windows.size < 10_000) return;
    for (const [key, entry] of windows) {
      if (entry.resetAt <= now) windows.delete(key);
    }
  }

  return function checkRateLimit(
    request: Request,
    sessionId?: string,
  ): Response | null {
    const now = Date.now();
    prune(now);

    const key = rateLimitKey(sessionId, clientIp(request));
    let entry = windows.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      windows.set(key, entry);
    }

    entry.count += 1;

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          retryAfter,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
          },
        },
      );
    }

    return null;
  };
}
