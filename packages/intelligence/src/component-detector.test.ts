import { describe, it, expect, afterEach } from 'vitest';
import { ComponentDetector } from './component-detector';

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

function createFixture(html: string): Element {
  const div = document.createElement('div');
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ComponentDetector', () => {
  const detector = new ComponentDetector();

  // -----------------------------------------------------------------------
  // Strategy 1: data-guidekit-component annotations
  // -----------------------------------------------------------------------
  describe('annotated elements (data-guidekit-component)', () => {
    it('detects annotated elements with confidence 1.0', () => {
      const root = createFixture(`
        <div data-guidekit-component="modal">
          <h2>Settings</h2>
          <button>Close</button>
        </div>
      `);

      const nodes = detector.detect(root);
      expect(nodes.length).toBeGreaterThanOrEqual(1);
      const modal = nodes.find((n) => n.type === 'modal' && n.confidence === 1.0);
      expect(modal).toBeDefined();
      expect(modal!.confidence).toBe(1.0);
    });

    it('normalizes unknown type to "unknown"', () => {
      const root = createFixture(`
        <div data-guidekit-component="fancy-widget">Content</div>
      `);
      const nodes = detector.detect(root);
      const unknown = nodes.find((n) => n.type === 'unknown');
      expect(unknown).toBeDefined();
      expect(unknown!.confidence).toBe(1.0);
    });
  });

  // -----------------------------------------------------------------------
  // Strategy 2: ARIA role patterns
  // -----------------------------------------------------------------------
  describe('ARIA role patterns', () => {
    it('detects tablist as tab-group', () => {
      const root = createFixture(`
        <div role="tablist">
          <button role="tab" aria-selected="true">Tab 1</button>
          <button role="tab">Tab 2</button>
        </div>
      `);
      const nodes = detector.detect(root);
      const tabGroup = nodes.find((n) => n.type === 'tab-group');
      expect(tabGroup).toBeDefined();
      expect(tabGroup!.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('detects dialog role as modal', () => {
      const root = createFixture(`
        <div role="dialog" aria-label="Confirm deletion">
          <p>Are you sure?</p>
          <button>Confirm</button>
        </div>
      `);
      const nodes = detector.detect(root);
      const modal = nodes.find((n) => n.type === 'modal');
      expect(modal).toBeDefined();
      expect(modal!.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('detects menu role as dropdown', () => {
      const root = createFixture(`
        <ul role="menu">
          <li role="menuitem">Option A</li>
          <li role="menuitem">Option B</li>
        </ul>
      `);
      const nodes = detector.detect(root);
      const dropdown = nodes.find((n) => n.type === 'dropdown');
      expect(dropdown).toBeDefined();
      expect(dropdown!.confidence).toBeGreaterThanOrEqual(0.8);
    });
  });

  // -----------------------------------------------------------------------
  // Strategy 3: CSS class patterns
  // -----------------------------------------------------------------------
  describe('CSS class patterns', () => {
    it('detects .card class as card', () => {
      const root = createFixture(`
        <div class="card">
          <h3>Product</h3>
          <p>Description</p>
        </div>
      `);
      const nodes = detector.detect(root);
      const card = nodes.find((n) => n.type === 'card');
      expect(card).toBeDefined();
      expect(card!.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('detects .modal class as modal', () => {
      const root = createFixture(`
        <div class="modal">
          <h2>Dialog Title</h2>
          <button>OK</button>
        </div>
      `);
      const nodes = detector.detect(root);
      const modal = nodes.find((n) => n.type === 'modal');
      expect(modal).toBeDefined();
    });

    it('detects .accordion class as accordion', () => {
      const root = createFixture(`
        <div class="accordion">
          <div aria-expanded="true">Panel 1 content</div>
          <div aria-expanded="false">Panel 2 content</div>
        </div>
      `);
      const nodes = detector.detect(root);
      const accordion = nodes.find((n) => n.type === 'accordion');
      expect(accordion).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Strategy 4: Structural heuristics
  // -----------------------------------------------------------------------
  describe('structural heuristics', () => {
    it('detects 3+ repeated siblings as cards', () => {
      const root = createFixture(`
        <div>
          <div class="item">Item 1</div>
          <div class="item">Item 2</div>
          <div class="item">Item 3</div>
        </div>
      `);
      const nodes = detector.detect(root);
      const card = nodes.find((n) => n.type === 'card' && n.confidence === 0.5);
      expect(card).toBeDefined();
    });

    it('does not detect fewer than 3 siblings as cards', () => {
      const root = createFixture(`
        <div>
          <div class="item">Item 1</div>
          <div class="item">Item 2</div>
        </div>
      `);
      const nodes = detector.detect(root);
      // No structural card detected (only 2 siblings)
      const structuralCard = nodes.find(
        (n) => n.type === 'card' && n.confidence === 0.5,
      );
      expect(structuralCard).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // ComponentNode shape validation
  // -----------------------------------------------------------------------
  describe('ComponentNode shape', () => {
    it('returns correct shape with id, type, selector, label, confidence, interactiveElements', () => {
      const root = createFixture(`
        <div data-guidekit-component="tab-group" aria-label="Main tabs">
          <button role="tab">Tab A</button>
          <button role="tab">Tab B</button>
        </div>
      `);
      const nodes = detector.detect(root);
      expect(nodes.length).toBeGreaterThanOrEqual(1);
      const node = nodes[0]!;
      expect(node).toHaveProperty('id');
      expect(node).toHaveProperty('type');
      expect(node).toHaveProperty('selector');
      expect(node).toHaveProperty('label');
      expect(node).toHaveProperty('confidence');
      expect(node).toHaveProperty('interactiveElements');
      expect(typeof node.id).toBe('string');
      expect(typeof node.selector).toBe('string');
      expect(typeof node.label).toBe('string');
      expect(typeof node.confidence).toBe('number');
      expect(Array.isArray(node.interactiveElements)).toBe(true);
    });

    it('includes interactive child elements in interactiveElements', () => {
      const root = createFixture(`
        <div data-guidekit-component="modal">
          <h2>Confirm</h2>
          <button>OK</button>
          <a href="/cancel">Cancel</a>
        </div>
      `);
      const nodes = detector.detect(root);
      const modal = nodes.find((n) => n.type === 'modal');
      expect(modal).toBeDefined();
      expect(modal!.interactiveElements.length).toBeGreaterThanOrEqual(2);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('returns empty array for no matches', () => {
      const root = createFixture('<p>Just a paragraph</p>');
      const nodes = detector.detect(root);
      expect(nodes).toEqual([]);
    });

    it('extracts label from aria-label', () => {
      const root = createFixture(`
        <div role="dialog" aria-label="Delete confirmation">
          <button>Confirm</button>
        </div>
      `);
      const nodes = detector.detect(root);
      const modal = nodes.find((n) => n.type === 'modal');
      expect(modal).toBeDefined();
      expect(modal!.label).toBe('Delete confirmation');
    });

    it('extracts label from heading children', () => {
      const root = createFixture(`
        <div data-guidekit-component="card">
          <h3>Product Details</h3>
          <p>Some info</p>
        </div>
      `);
      const nodes = detector.detect(root);
      const card = nodes.find((n) => n.type === 'card');
      expect(card).toBeDefined();
      expect(card!.label).toBe('Product Details');
    });
  });
});
