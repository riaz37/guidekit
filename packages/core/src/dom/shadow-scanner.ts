/**
 * @module @guidekit/core/dom/shadow-scanner
 *
 * Open Shadow DOM traversal for SPA content discovery.
 */

import type { InteractiveElement } from '../types/index.js';

const SHADOW_HOST_DENY = new Set(['guidekit-widget', 'guidekit-root']);

export interface ShadowScanOptions {
  maxHosts?: number;
  maxDepth?: number;
}

export function collectShadowInteractiveElements(
  root: Element,
  options: ShadowScanOptions = {},
): InteractiveElement[] {
  const maxHosts = options.maxHosts ?? 50;
  const maxDepth = options.maxDepth ?? 8;
  const results: InteractiveElement[] = [];
  let hostCount = 0;

  function walk(node: Element, depth: number): void {
    if (depth > maxDepth || hostCount >= maxHosts) return;

    const shadow = (node as HTMLElement).shadowRoot;
    if (shadow) {
      const tag = node.tagName.toLowerCase();
      if (!SHADOW_HOST_DENY.has(tag) && !node.closest('[data-guidekit-widget]')) {
        hostCount += 1;
        for (const child of shadow.querySelectorAll(
          'button, a[href], input, select, textarea, [role="button"]',
        )) {
          if (!(child instanceof HTMLElement)) continue;
          const label =
            child.getAttribute('aria-label') ??
            child.textContent?.trim().slice(0, 80) ??
            child.tagName.toLowerCase();
          results.push({
            selector: `[data-gk-shadow="${hostCount}"] ${child.tagName.toLowerCase()}`,
            tagName: child.tagName.toLowerCase(),
            type: child.tagName.toLowerCase() === 'a' ? 'link' : 'button',
            label,
            isDisabled: child.hasAttribute('disabled'),
          });
        }
      }
    }

    for (const child of node.children) {
      walk(child, depth + 1);
    }
  }

  walk(root, 0);
  return results;
}
