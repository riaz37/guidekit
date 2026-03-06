import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { HeadingExtractor } from './heading-extractor';

// Polyfill CSS.escape for jsdom
if (typeof globalThis.CSS === 'undefined') {
  (globalThis as Record<string, unknown>).CSS = {} as typeof CSS;
}
if (typeof CSS.escape !== 'function') {
  CSS.escape = (value: string): string => {
    // eslint-disable-next-line no-control-regex
    return value.replace(/([\0-\x1f\x7f]|^[0-9]|[-](?=[0-9]))/g, '\\$&')
      .replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  };
}

/**
 * Create a DOM fixture and patch offsetParent on all heading elements
 * so that jsdom's isVisible check works (jsdom always returns null for
 * offsetParent). Headings with `hidden` attribute or `display:none` are
 * left with offsetParent = null.
 */
function createFixture(html: string): Element {
  const div = document.createElement('div');
  div.innerHTML = html;
  document.body.appendChild(div);

  // Patch offsetParent for all heading elements so isVisible works
  const headings = div.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6');
  headings.forEach((h) => {
    const isHidden =
      h.hidden || h.style.display === 'none' || h.getAttribute('hidden') !== null;
    if (!isHidden) {
      Object.defineProperty(h, 'offsetParent', {
        get: () => document.body,
        configurable: true,
      });
    }
  });

  return div;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('HeadingExtractor', () => {
  const extractor = new HeadingExtractor();

  // -----------------------------------------------------------------------
  // Flat list
  // -----------------------------------------------------------------------
  describe('flat headings', () => {
    it('builds flat list from same-level headings', () => {
      const root = createFixture(`
        <h2>Section A</h2>
        <p>Content A</p>
        <h2>Section B</h2>
        <p>Content B</p>
        <h2>Section C</h2>
      `);
      const nodes = extractor.extract(root);
      expect(nodes).toHaveLength(3);
      expect(nodes[0]!.text).toBe('Section A');
      expect(nodes[1]!.text).toBe('Section B');
      expect(nodes[2]!.text).toBe('Section C');
      // All same level — no nesting
      nodes.forEach((n) => {
        expect(n.children).toHaveLength(0);
      });
    });
  });

  // -----------------------------------------------------------------------
  // Nested tree
  // -----------------------------------------------------------------------
  describe('nested tree', () => {
    it('builds nested tree (h2 under h1, h3 under h2)', () => {
      const root = createFixture(`
        <h1>Title</h1>
        <h2>Chapter 1</h2>
        <h3>Section 1.1</h3>
        <h3>Section 1.2</h3>
        <h2>Chapter 2</h2>
        <h3>Section 2.1</h3>
      `);
      const nodes = extractor.extract(root);
      // Top level: just h1
      expect(nodes).toHaveLength(1);
      const h1 = nodes[0]!;
      expect(h1.text).toBe('Title');
      expect(h1.level).toBe(1);
      expect(h1.children).toHaveLength(2);

      const ch1 = h1.children[0]!;
      expect(ch1.text).toBe('Chapter 1');
      expect(ch1.level).toBe(2);
      expect(ch1.children).toHaveLength(2);

      const ch2 = h1.children[1]!;
      expect(ch2.text).toBe('Chapter 2');
      expect(ch2.children).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Hidden headings
  // -----------------------------------------------------------------------
  describe('hidden headings', () => {
    it('skips hidden headings', () => {
      const root = createFixture(`
        <h2>Visible</h2>
        <h2 hidden>Hidden One</h2>
      `);
      const nodes = extractor.extract(root);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]!.text).toBe('Visible');
    });

    it('skips display:none headings', () => {
      const root = createFixture(`
        <h2>Shown</h2>
        <h2 style="display:none">Not Shown</h2>
        <h2>Also Shown</h2>
      `);
      const nodes = extractor.extract(root);
      expect(nodes).toHaveLength(2);
      expect(nodes[0]!.text).toBe('Shown');
      expect(nodes[1]!.text).toBe('Also Shown');
    });
  });

  // -----------------------------------------------------------------------
  // Empty headings
  // -----------------------------------------------------------------------
  describe('empty headings', () => {
    it('skips empty headings', () => {
      const root = createFixture(`
        <h2></h2>
        <h2>   </h2>
        <h2>Real Heading</h2>
      `);
      const nodes = extractor.extract(root);
      const emptyNodes = nodes.filter((n) => n.text === '' || n.text.trim() === '');
      expect(emptyNodes).toHaveLength(0);
      // Only the non-empty heading should appear
      expect(nodes).toHaveLength(1);
      expect(nodes[0]!.text).toBe('Real Heading');
    });
  });

  // -----------------------------------------------------------------------
  // ID generation
  // -----------------------------------------------------------------------
  describe('ID generation', () => {
    it('generates slug IDs from text', () => {
      const root = createFixture(`<h2>Hello World</h2>`);
      const nodes = extractor.extract(root);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]!.id).toBe('hello-world');
    });

    it('uses element id when available', () => {
      const root = createFixture(`<h2 id="custom-id">My Section</h2>`);
      const nodes = extractor.extract(root);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]!.id).toBe('custom-id');
    });

    it('handles duplicate IDs with suffix', () => {
      const root = createFixture(`
        <h2>Same Title</h2>
        <h2>Same Title</h2>
      `);
      const nodes = extractor.extract(root);
      expect(nodes).toHaveLength(2);
      expect(nodes[0]!.id).toBe('same-title');
      expect(nodes[1]!.id).toBe('same-title-1');
    });
  });

  // -----------------------------------------------------------------------
  // aria-label preference
  // -----------------------------------------------------------------------
  describe('aria-label', () => {
    it('uses aria-label over textContent', () => {
      const root = createFixture(
        `<h2 aria-label="Accessible Title">Visual Title</h2>`,
      );
      const nodes = extractor.extract(root);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]!.text).toBe('Accessible Title');
    });
  });
});
