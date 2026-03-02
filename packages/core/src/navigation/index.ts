// ---------------------------------------------------------------------------
// GuideKit SDK – Navigation Controller
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[GuideKit:Nav]';

export interface NavigationControllerOptions {
  debug?: boolean;
  /** Developer-provided router for guaranteed SPA navigation. */
  router?: {
    push: (href: string) => void | Promise<void>;
  };
}

/**
 * Manages SPA navigation detection and programmatic routing.
 *
 * - Prefers the Navigation API (Chrome 102+) where available.
 * - Falls back to `popstate` + periodic URL polling (200ms).
 * - Developer can pass a `router` prop for guaranteed SPA nav.
 */
export class NavigationController {
  private readonly debug: boolean;
  private readonly router?: { push: (href: string) => void | Promise<void> };

  private currentUrl: string = '';
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private callbacks: Array<(from: string, to: string) => void> = [];
  private cleanups: Array<() => void> = [];

  constructor(options?: NavigationControllerOptions) {
    this.debug = options?.debug ?? false;
    this.router = options?.router;
  }

  /** Start listening for navigation events. */
  start(): void {
    if (typeof window === 'undefined') return;

    this.currentUrl = window.location.href;

    // Prefer Navigation API
    if ('navigation' in window && typeof (window as any).navigation?.addEventListener === 'function') {
      const nav = (window as any).navigation;
      const handler = (event: any) => {
        const to = event.destination?.url ?? window.location.href;
        this.handleRouteChange(to);
      };
      nav.addEventListener('navigate', handler);
      this.cleanups.push(() => nav.removeEventListener('navigate', handler));

      if (this.debug) console.debug(LOG_PREFIX, 'Using Navigation API');
    } else {
      // Fallback: popstate + polling
      const popHandler = () => {
        this.handleRouteChange(window.location.href);
      };
      window.addEventListener('popstate', popHandler);
      this.cleanups.push(() => window.removeEventListener('popstate', popHandler));

      // Poll every 200ms for pushState changes
      this.pollingTimer = setInterval(() => {
        if (window.location.href !== this.currentUrl) {
          this.handleRouteChange(window.location.href);
        }
      }, 200);

      if (this.debug) console.debug(LOG_PREFIX, 'Using popstate + URL polling fallback');
    }
  }

  /** Stop listening for navigation events. */
  stop(): void {
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups = [];

    if (this.pollingTimer !== null) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  /**
   * Subscribe to route changes.
   * @returns Unsubscribe function.
   */
  onRouteChange(callback: (from: string, to: string) => void): () => void {
    this.callbacks.push(callback);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const idx = this.callbacks.indexOf(callback);
      if (idx !== -1) this.callbacks.splice(idx, 1);
    };
  }

  /**
   * Programmatically navigate to a URL.
   * Validates same-origin before navigating.
   */
  async navigate(href: string): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    // Same-origin validation
    try {
      const target = new URL(href, window.location.origin);
      if (target.origin !== window.location.origin) {
        if (this.debug) console.warn(LOG_PREFIX, 'Blocked cross-origin navigation to', href);
        return false;
      }
      href = target.href;
    } catch {
      if (this.debug) console.warn(LOG_PREFIX, 'Invalid URL:', href);
      return false;
    }

    // Use developer-provided router if available
    if (this.router) {
      await this.router.push(href);
      return true;
    }

    // Fallback: update location
    window.location.href = href;
    return true;
  }

  /** Get the current URL. */
  get url(): string {
    if (typeof window === 'undefined') return '';
    return window.location.href;
  }

  private handleRouteChange(newUrl: string): void {
    if (newUrl === this.currentUrl) return;

    const from = this.currentUrl;
    this.currentUrl = newUrl;

    if (this.debug) console.debug(LOG_PREFIX, `Route change: ${from} → ${newUrl}`);

    for (const callback of this.callbacks.slice()) {
      try {
        callback(from, newUrl);
      } catch (err) {
        console.error(LOG_PREFIX, 'Route change handler error:', err);
      }
    }
  }
}
