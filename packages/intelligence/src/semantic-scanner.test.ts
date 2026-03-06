import { describe, it, expect, afterEach } from 'vitest';
import { SemanticScanner } from './semantic-scanner';
import type { PageModel } from '@guidekit/core';

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

function createBasePageModel(overrides: Partial<PageModel> = {}): PageModel {
  return {
    url: 'https://example.com',
    title: 'Test Page',
    meta: { description: '', h1: 'Test', language: 'en' },
    sections: [],
    navigation: [],
    interactiveElements: [],
    forms: [],
    activeOverlays: [],
    viewport: { width: 1280, height: 720, orientation: 'landscape' },
    allSectionsSummary: [],
    hash: 'abc123',
    timestamp: Date.now(),
    scanMetadata: {
      totalSectionsFound: 0,
      sectionsIncluded: 0,
      totalNodesScanned: 0,
      scanBudgetExhausted: false,
    },
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SemanticScanner', () => {
  // -----------------------------------------------------------------------
  // Full scan enrichment
  // -----------------------------------------------------------------------
  describe('scan()', () => {
    it('enriches a base PageModel with all semantic fields', () => {
      const root = createFixture(`
        <div data-guidekit-component="card">
          <h2>Product</h2>
          <button>Buy</button>
        </div>
        <div class="error">Something failed</div>
        <div class="step active">Step 1</div>
        <div class="step">Step 2</div>
      `);

      const scanner = new SemanticScanner();
      const base = createBasePageModel();
      const result = scanner.scan(root, base);

      // Preserves base fields
      expect(result.url).toBe(base.url);
      expect(result.title).toBe(base.title);

      // Has semantic fields
      expect(result).toHaveProperty('components');
      expect(result).toHaveProperty('errorStates');
      expect(result).toHaveProperty('flowState');
      expect(result).toHaveProperty('headingOutline');
      expect(Array.isArray(result.components)).toBe(true);
      expect(Array.isArray(result.errorStates)).toBe(true);
      expect(Array.isArray(result.headingOutline)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Disabled options
  // -----------------------------------------------------------------------
  describe('disabled options', () => {
    it('enableComponents: false returns empty components', () => {
      const root = createFixture(`
        <div data-guidekit-component="modal"><h2>Modal</h2><button>Close</button></div>
      `);
      const scanner = new SemanticScanner({ enableComponents: false });
      const result = scanner.scan(root, createBasePageModel());
      expect(result.components).toEqual([]);
    });

    it('enableErrors: false returns empty errorStates', () => {
      const root = createFixture(`
        <div class="error">Bad thing happened</div>
      `);
      const scanner = new SemanticScanner({ enableErrors: false });
      const result = scanner.scan(root, createBasePageModel());
      expect(result.errorStates).toEqual([]);
    });

    it('enableFlow: false returns null flowState', () => {
      const root = createFixture(`
        <div class="step active">Step 1</div>
        <div class="step">Step 2</div>
      `);
      const scanner = new SemanticScanner({ enableFlow: false });
      const result = scanner.scan(root, createBasePageModel());
      expect(result.flowState).toBeNull();
    });

    it('enableHeadings: false returns empty headingOutline', () => {
      const root = createFixture(`
        <h1>Title</h1>
        <h2>Subtitle</h2>
      `);
      const scanner = new SemanticScanner({ enableHeadings: false });
      const result = scanner.scan(root, createBasePageModel());
      expect(result.headingOutline).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // scanWithTiming
  // -----------------------------------------------------------------------
  describe('scanWithTiming()', () => {
    it('returns durationMs >= 0', () => {
      const root = createFixture('<div><p>Simple content</p></div>');
      const scanner = new SemanticScanner();
      const { model, durationMs } = scanner.scanWithTiming(
        root,
        createBasePageModel(),
      );
      expect(durationMs).toBeGreaterThanOrEqual(0);
      expect(model).toHaveProperty('components');
      expect(model).toHaveProperty('errorStates');
      expect(model).toHaveProperty('flowState');
      expect(model).toHaveProperty('headingOutline');
    });
  });
});
