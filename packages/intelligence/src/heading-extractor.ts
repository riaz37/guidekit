/**
 * Heading Outline Extractor — builds a hierarchical tree from h1-h6 elements.
 * @module
 */
import type { HeadingNode } from '@guidekit/core';

/** Generate a URL-friendly slug from text. */
function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/** Check whether a heading element is visible. */
function isVisible(el: HTMLElement): boolean {
  return !el.hidden && el.style.display !== 'none' && el.offsetParent !== null;
}

/** Build the most specific CSS selector for a heading element. */
function buildSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;
  const siblings = Array.from(parent.children).filter(
    (s) => s.tagName === el.tagName,
  );
  const idx = siblings.indexOf(el) + 1;
  return `${tag}:nth-of-type(${idx})`;
}

export class HeadingExtractor {
  extract(root: Element): HeadingNode[] {
    const elements = root.querySelectorAll<HTMLElement>(
      'h1, h2, h3, h4, h5, h6',
    );
    const usedIds = new Set<string>();
    const nodes: HeadingNode[] = [];

    for (const el of elements) {
      if (!isVisible(el)) continue;

      const text = (el.getAttribute('aria-label') || el.textContent || '')
        .trim();
      if (!text) continue;

      const level = parseInt(el.tagName[1] ?? '0', 10);

      // Resolve a unique id.
      let id = el.id || slugify(text);
      if (usedIds.has(id)) {
        let suffix = 1;
        while (usedIds.has(`${id}-${suffix}`)) suffix++;
        id = `${id}-${suffix}`;
      }
      usedIds.add(id);

      const node: HeadingNode = {
        level,
        text,
        id,
        selector: buildSelector(el),
        children: [],
      };
      nodes.push(node);
    }

    return buildTree(nodes);
  }
}

/** Nest a flat list of HeadingNodes into a hierarchy by level. */
function buildTree(flat: HeadingNode[]): HeadingNode[] {
  const roots: HeadingNode[] = [];
  const stack: HeadingNode[] = [];

  for (const node of flat) {
    // Pop stack until we find a parent with a lower level.
    while (stack.length > 0 && stack[stack.length - 1]!.level >= node.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1]!.children.push(node);
    }
    stack.push(node);
  }

  return roots;
}
