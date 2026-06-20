import { describe, it, expect } from 'vitest';
import {
  PageMemoryStore,
  buildPageMemory,
  computeTurnDelta,
  buildWorkingSet,
  formatCrossOriginIframeNotice,
  pageKeyFromModel,
} from './page-memory.js';
import type { PageModel } from '../types/index.js';

function baseModel(overrides?: Partial<PageModel>): PageModel {
  return {
    url: 'https://example.com/pricing',
    title: 'Pricing',
    meta: { description: '', h1: 'Plans', language: 'en' },
    sections: [
      {
        id: 'hero',
        selector: '#hero',
        tagName: 'section',
        label: 'Hero',
        summary: 'Welcome',
        isVisible: true,
        visibilityRatio: 1,
        score: 100,
        hasInteractiveElements: false,
        depth: 1,
      },
    ],
    navigation: [],
    interactiveElements: [],
    forms: [],
    activeOverlays: [],
    viewport: { width: 1280, height: 720, orientation: 'landscape' },
    allSectionsSummary: [],
    hash: 'hash1',
    timestamp: Date.now(),
    scanMetadata: {
      totalSectionsFound: 1,
      sectionsIncluded: 1,
      totalNodesScanned: 10,
      scanBudgetExhausted: false,
    },
    ...overrides,
  };
}

describe('page-memory', () => {
  it('buildPageMemory captures summary and sections', () => {
    const memory = buildPageMemory(baseModel());
    expect(memory.summary).toContain('Pricing');
    expect(memory.sectionLines.some((l) => l.includes('[hero]'))).toBe(true);
  });

  it('computeTurnDelta detects hash change', () => {
    const prev = baseModel({ hash: 'a' });
    const next = baseModel({ hash: 'b' });
    const delta = computeTurnDelta(prev, next);
    expect(delta.hashChanged).toBe(true);
  });

  it('PageMemoryStore rebuilds on hash change and deltas on same hash', () => {
    const store = new PageMemoryStore();
    const first = store.prepare(baseModel());
    expect(first.rebuilt).toBe(true);

    const second = store.prepare(baseModel());
    expect(second.rebuilt).toBe(false);
    expect(formatCrossOriginIframeNotice(baseModel())).toBeNull();
  });

  it('buildWorkingSet prefers visible sections', () => {
    const model = baseModel({
      sections: [
        {
          id: 'hidden',
          selector: '#hidden',
          tagName: 'div',
          label: 'Hidden',
          summary: 'Off screen',
          isVisible: false,
          visibilityRatio: 0,
          score: 50,
          hasInteractiveElements: false,
          depth: 2,
        },
        {
          id: 'visible',
          selector: '#visible',
          tagName: 'div',
          label: 'Visible',
          summary: 'On screen',
          isVisible: true,
          visibilityRatio: 0.9,
          score: 80,
          hasInteractiveElements: true,
          depth: 1,
        },
      ],
    });
    const set = buildWorkingSet(model);
    expect(set.visibleSections[0]?.id).toBe('visible');
  });

  it('formatCrossOriginIframeNotice lists cross-origin frames', () => {
    const notice = formatCrossOriginIframeNotice(
      baseModel({
        scanMetadata: {
          totalSectionsFound: 1,
          sectionsIncluded: 1,
          totalNodesScanned: 10,
          scanBudgetExhausted: false,
          crossOriginIframes: [{ index: 1, src: 'https://other.com', title: 'Ads', sandbox: null }],
        },
      }),
    );
    expect(notice).toContain('cross-origin iframe');
    expect(notice).toContain('Ads');
  });

  it('pageKeyFromModel uses origin and pathname', () => {
    expect(pageKeyFromModel(baseModel())).toBe('https://example.com/pricing');
  });
});
