import { describe, it, expect } from 'vitest';
import {
  resolveElement,
  resolveSectionSelector,
  resolveInteractiveByLabel,
  assessDangerousClick,
} from './element-resolver.js';
import type { PageModel } from '../types/index.js';

const model: PageModel = {
  url: 'https://example.com',
  title: 'Test',
  meta: { description: '', h1: '', language: 'en' },
  sections: [
    {
      id: 'pricing',
      selector: '#pricing',
      tagName: 'section',
      label: 'Pricing',
      summary: 'Plans',
      isVisible: true,
      visibilityRatio: 1,
      score: 90,
      hasInteractiveElements: true,
      depth: 1,
    },
  ],
  navigation: [],
  interactiveElements: [
    {
      tagName: 'button',
      label: 'Get Started',
      selector: '#cta',
      type: 'button',
      isDisabled: false,
      guideKitTarget: true,
    },
  ],
  forms: [],
  activeOverlays: [],
  viewport: { width: 1280, height: 720, orientation: 'landscape' },
  allSectionsSummary: [],
  hash: 'x',
  timestamp: Date.now(),
  scanMetadata: {
    totalSectionsFound: 1,
    sectionsIncluded: 1,
    totalNodesScanned: 5,
    scanBudgetExhausted: false,
  },
};

describe('element-resolver', () => {
  it('resolveSectionSelector finds by id', () => {
    const result = resolveSectionSelector(model, 'pricing');
    expect(result?.selector).toBe('#pricing');
    expect(result!.confidence).toBeGreaterThan(0.8);
  });

  it('resolveInteractiveByLabel fuzzy matches', () => {
    const result = resolveInteractiveByLabel(model, 'get started');
    expect(result?.selector).toBe('#cta');
  });

  it('resolveElement prefers explicit selector', () => {
    const result = resolveElement(model, { selector: '#custom' });
    expect(result?.selector).toBe('#custom');
    expect(result?.confidence).toBe(1);
  });

  it('assessDangerousClick blocks submit selectors', () => {
    const result = assessDangerousClick('form button[type="submit"]', null);
    expect(result.blocked).toBe(true);
  });

  it('assessDangerousClick blocks destructive labels', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Delete account';
    expect(assessDangerousClick('#delete', btn).blocked).toBe(true);
  });
});
