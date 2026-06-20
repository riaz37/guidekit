/**
 * Scroll viewport and rescan for virtualized or off-screen content.
 */

import type { DOMScanner } from './index.js';
import type { PageModel } from '../types/index.js';

export interface ScrollAndRescanOptions {
  /** Scroll down in viewport-height steps (default 2). */
  steps?: number;
  /** Pause between scroll steps in ms (default 150). */
  stepDelayMs?: number;
  /** Restore scroll position after rescan (default true). */
  restoreScroll?: boolean;
}

/**
 * Scroll the window down and rescan to pick up lazy-loaded or virtualized DOM.
 */
export async function scrollAndRescan(
  scanner: DOMScanner,
  options?: ScrollAndRescanOptions,
): Promise<PageModel> {
  if (typeof window === 'undefined') {
    return scanner.scan();
  }

  const steps = options?.steps ?? 2;
  const stepDelayMs = options?.stepDelayMs ?? 150;
  const restoreScroll = options?.restoreScroll !== false;
  const startY = window.scrollY;
  const viewport = window.innerHeight;

  for (let i = 0; i < steps; i++) {
    window.scrollBy({ top: viewport * 0.85, behavior: 'instant' as ScrollBehavior });
    await new Promise((r) => setTimeout(r, stepDelayMs));
  }

  const model = scanner.scan();

  if (restoreScroll) {
    window.scrollTo({ top: startY, behavior: 'instant' as ScrollBehavior });
  }

  return model;
}
