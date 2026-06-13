// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { ContextManager } from './index.js';
import type { PageModel } from '../types/index.js';

function makePageModel(sectionCount = 30): PageModel {
  return {
    url: 'https://example.com/app',
    title: 'Test App',
    meta: { description: 'desc', h1: 'Test', language: 'en' },
    sections: Array.from({ length: sectionCount }, (_, i) => ({
      id: `section-${i}`,
      selector: `#section-${i}`,
      tagName: 'SECTION',
      label: `Section ${i}`,
      summary: `Summary for section ${i} `.repeat(20),
      isVisible: true,
      visibilityRatio: 1,
      score: 0.8,
      hasInteractiveElements: false,
      depth: 1,
    })),
    navigation: [],
    interactiveElements: [],
    forms: [],
    activeOverlays: [],
    viewport: { width: 1280, height: 720, orientation: 'landscape' },
    allSectionsSummary: [],
    hash: 'abc',
    timestamp: Date.now(),
    scanMetadata: {
      totalSectionsFound: sectionCount,
      sectionsIncluded: sectionCount,
      totalNodesScanned: 100,
      scanBudgetExhausted: false,
    },
  };
}

describe('Token budget integration (50-turn conversation)', () => {
  it('keeps system prompt within budget after 50 turns without silent overflow', async () => {
    const manager = new ContextManager({ tokenBudget: 2_000, maxTurns: 50 });
    await manager.initTokenBudget();

    for (let i = 0; i < 50; i++) {
      manager.addTurn({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content:
          i % 2 === 0
            ? `User question ${i}: 请告诉我这个页面的功能在哪里？Where is feature ${i}?`
            : `Assistant reply ${i}: Highlight section-${i % 10} and explain briefly.`,
        timestamp: Date.now() + i,
      });
    }

    const prompt = manager.buildSystemPrompt(makePageModel(), []);
    const promptTokens = manager.countTokens(prompt);
    expect(promptTokens).toBeLessThanOrEqual(2_000);
    expect(manager.getHistory().length).toBeLessThanOrEqual(50);
  });

  it('handles CJK content with heuristic tokenizer', () => {
    const manager = new ContextManager({ tokenBudget: 500 });
    const cjk = '这是一个中文测试句子，用于验证令牌估算。'.repeat(10);
    const tokens = manager.countTokens(cjk);
    expect(tokens).toBeGreaterThan(cjk.length / 8);
    expect(tokens).toBeLessThan(cjk.length * 2);
  });
});
