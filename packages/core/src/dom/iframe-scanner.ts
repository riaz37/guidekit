/**
 * @module @guidekit/core/dom/iframe-scanner
 *
 * Same-origin iframe content merge for embedded app surfaces.
 */

import type { PageSection } from '../types/index.js';

export interface CrossOriginIframeMeta {
  index: number;
  src: string | null;
  title: string | null;
  sandbox: string | null;
}

export interface IframeScanResult {
  sections: PageSection[];
  iframeCount: number;
  crossOriginIframes: CrossOriginIframeMeta[];
}

export function scanSameOriginIframes(
  root: Element,
  maxIframes = 5,
): IframeScanResult {
  const sections: PageSection[] = [];
  const crossOriginIframes: CrossOriginIframeMeta[] = [];
  const iframes = root.querySelectorAll('iframe');
  let count = 0;

  for (const iframe of iframes) {
    if (!(iframe instanceof HTMLIFrameElement)) continue;

    let doc: Document | null = null;
    try {
      doc = iframe.contentDocument;
    } catch {
      crossOriginIframes.push({
        index: crossOriginIframes.length + 1,
        src: iframe.src || null,
        title: iframe.title || iframe.getAttribute('aria-label'),
        sandbox: iframe.getAttribute('sandbox'),
      });
      continue;
    }
    if (!doc?.body) continue;
    if (count >= maxIframes) break;

    count += 1;
    const title =
      iframe.title ||
      iframe.getAttribute('aria-label') ||
      `iframe-${count}`;

    sections.push({
      id: `iframe-${count}`,
      selector: `iframe:nth-of-type(${count})`,
      tagName: 'IFRAME',
      label: title,
      summary: doc.body.textContent?.trim().slice(0, 200) ?? '',
      isVisible: iframe.offsetWidth > 0 && iframe.offsetHeight > 0,
      visibilityRatio: 1,
      score: 0.5,
      hasInteractiveElements: doc.querySelectorAll('button, a, input').length > 0,
      depth: 1,
    });
  }

  return { sections, iframeCount: count, crossOriginIframes };
}
