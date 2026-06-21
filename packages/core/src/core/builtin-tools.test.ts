import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getBuiltinToolSpecs } from './builtin-tools.js';
import type { BuiltinToolsHost } from './builtin-tools.js';
import type { PageModel } from '../types/index.js';

function createPageModel(): PageModel {
  return {
    url: 'http://localhost/current',
    title: 'Current',
    meta: { description: '', h1: null, language: 'en' },
    sections: [],
    navigation: [],
    interactiveElements: [
      {
        selector: '#delete-account',
        tagName: 'button',
        label: 'Delete account',
        isDisabled: false,
        actionRisk: 'destructive',
      },
      {
        selector: '#details',
        tagName: 'button',
        label: 'View details',
        isDisabled: false,
        actionRisk: 'safe',
      },
    ],
    forms: [],
    activeOverlays: [],
    viewport: { width: 1024, height: 768, orientation: 'landscape' },
    allSectionsSummary: [],
    hash: 'hash',
    timestamp: Date.now(),
    scanMetadata: {
      totalSectionsFound: 0,
      sectionsIncluded: 0,
      totalNodesScanned: 0,
      scanBudgetExhausted: false,
    },
  };
}

function createHost(overrides: Partial<BuiltinToolsHost> = {}): BuiltinToolsHost {
  const model = createPageModel();
  return {
    getPageModel: () => model,
    highlight: vi.fn(() => true),
    dismissHighlight: vi.fn(),
    scrollToSection: vi.fn(),
    scrollToSelector: vi.fn(),
    startTour: vi.fn(),
    nextTourStep: vi.fn(),
    prevTourStep: vi.fn(),
    stopTour: vi.fn(),
    navigate: vi.fn(async () => true),
    contextManager: {
      getContent: vi.fn(async () => null),
    } as unknown as BuiltinToolsHost['contextManager'],
    customActions: new Map(),
    bus: {
      emit: vi.fn(),
    } as unknown as BuiltinToolsHost['bus'],
    autonomy: {
      level: 'guided',
      allowNavigation: true,
      allowSafeClicks: true,
      requireConfirmationFor: ['submit', 'purchase', 'destructive', 'auth'],
    },
    siteKnowledge: {
      search: vi.fn(async () => ({
        results: [
          {
            id: 'pricing',
            title: 'Pricing',
            url: '/pricing',
            excerpt: 'The Pro plan includes autonomous website guidance.',
            score: 3,
          },
        ],
      })),
    },
    ...overrides,
  };
}

describe('builtin tools', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="delete-account">Delete account</button>
      <button id="details">View details</button>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('searchSite calls the configured site knowledge endpoint', async () => {
    const host = createHost();
    const tool = getBuiltinToolSpecs(host).find((spec) => spec.name === 'searchSite');

    expect(tool).toBeDefined();
    const result = await tool!.execute({ query: 'pro plan' });

    expect(host.siteKnowledge?.search).toHaveBeenCalledWith('pro plan', { topK: undefined });
    expect(result).toMatchObject({
      results: [
        {
          title: 'Pricing',
          url: '/pricing',
        },
      ],
    });
  });

  it('clickElement requires confirmation for classified risky actions', async () => {
    const host = createHost();
    const tool = getBuiltinToolSpecs(host).find((spec) => spec.name === 'clickElement')!;

    const result = await tool.execute({ selector: '#delete-account' });

    expect(result).toMatchObject({
      success: false,
      confirmationRequired: true,
    });
    expect(host.bus?.emit).toHaveBeenCalledWith(
      'action:confirmation-required',
      expect.objectContaining({ selector: '#delete-account', risk: 'destructive' }),
    );
  });

  it('clickElement reports submit controls as confirmation-required actions', async () => {
    const model = createPageModel();
    model.interactiveElements.push({
      selector: '#submit-order',
      tagName: 'button',
      type: 'submit',
      label: 'Submit order',
      isDisabled: false,
      actionRisk: 'submit',
    });
    const host = createHost({ getPageModel: () => model });
    document.body.insertAdjacentHTML('beforeend', '<button id="submit-order" type="submit">Submit order</button>');
    const tool = getBuiltinToolSpecs(host).find((spec) => spec.name === 'clickElement')!;

    const result = await tool.execute({ selector: '#submit-order' });

    expect(result).toMatchObject({
      success: false,
      confirmationRequired: true,
      risk: 'submit',
    });
    expect(host.bus?.emit).toHaveBeenCalledWith(
      'action:confirmation-required',
      expect.objectContaining({ selector: '#submit-order', risk: 'submit' }),
    );
  });

  it('clickElement allows safe clicks when guided autonomy permits them', async () => {
    const host = createHost();
    const clickSpy = vi.spyOn(document.querySelector('#details') as HTMLElement, 'click');
    const tool = getBuiltinToolSpecs(host).find((spec) => spec.name === 'clickElement')!;

    const result = await tool.execute({ selector: '#details' });

    expect(result).toEqual({ success: true });
    expect(clickSpy).toHaveBeenCalledOnce();
  });
});
