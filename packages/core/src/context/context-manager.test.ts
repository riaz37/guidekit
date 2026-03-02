/**
 * Unit tests for ContextManager
 *
 * @module @guidekit/core/context
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextManager } from './index.js';
import type {
  PageModel,
  ConversationTurn,
  ContentMapEntry,
  ToolDefinition,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockPageModel: PageModel = {
  url: 'https://example.com',
  title: 'Test Page',
  meta: { description: 'Test description', h1: 'Welcome', language: 'en' },
  sections: [
    {
      id: 'hero',
      selector: '#hero',
      tagName: 'SECTION',
      label: 'Hero',
      summary: 'Welcome text',
      isVisible: true,
      visibilityRatio: 1,
      score: 100,
      hasInteractiveElements: false,
      depth: 1,
    },
  ],
  navigation: [
    { label: 'Home', href: '/', isCurrent: true, selector: 'nav a:first-child' },
  ],
  interactiveElements: [],
  forms: [],
  activeOverlays: [],
  viewport: { width: 1920, height: 1080, orientation: 'landscape' },
  allSectionsSummary: ['Hero: Welcome text'],
  hash: 'abc123',
  timestamp: Date.now(),
  scanMetadata: {
    totalSectionsFound: 1,
    sectionsIncluded: 1,
    totalNodesScanned: 50,
    scanBudgetExhausted: false,
  },
};

const mockTools: ToolDefinition[] = [
  {
    name: 'highlight',
    description: 'Highlight an element on the page',
    parameters: { type: 'object', properties: { selector: { type: 'string' } } },
    schemaVersion: 1,
  },
];

function makeTurn(
  role: 'user' | 'assistant',
  content: string,
  timestamp?: number,
): ConversationTurn {
  return { role, content, timestamp: timestamp ?? Date.now() };
}

// ---------------------------------------------------------------------------
// Tests: buildSystemPrompt
// ---------------------------------------------------------------------------

describe('ContextManager', () => {
  let cm: ContextManager;

  beforeEach(() => {
    cm = new ContextManager();
  });

  // -----------------------------------------------------------------------
  // buildSystemPrompt
  // -----------------------------------------------------------------------

  describe('buildSystemPrompt()', () => {
    it('returns a string containing role, page context, sections, and navigation', () => {
      const prompt = cm.buildSystemPrompt(mockPageModel, mockTools);

      expect(typeof prompt).toBe('string');
      // Role
      expect(prompt).toContain('# Role');
      expect(prompt).toContain('GuideKit');
      // Current page
      expect(prompt).toContain('# Current Page');
      expect(prompt).toContain('https://example.com');
      expect(prompt).toContain('Test Page');
      // Sections
      expect(prompt).toContain('# Page Sections');
      expect(prompt).toContain('[hero]');
      expect(prompt).toContain('Hero');
      // Navigation
      expect(prompt).toContain('# Navigation');
      expect(prompt).toContain('Home');
      expect(prompt).toContain('(current)');
    });

    it('includes truncation metadata when sections are truncated', () => {
      const manyModel: PageModel = {
        ...mockPageModel,
        scanMetadata: {
          totalSectionsFound: 50,
          sectionsIncluded: 10,
          totalNodesScanned: 500,
          scanBudgetExhausted: true,
        },
      };

      const prompt = cm.buildSystemPrompt(manyModel, []);
      expect(prompt).toContain('10 of 50');
      expect(prompt).toContain('readPageContent');
    });

    it('respects token budget (~6000 chars)', () => {
      // Create a page model with many long sections to force budget enforcement
      const largeSections = Array.from({ length: 100 }, (_, i) => ({
        id: `section-${i}`,
        selector: `#section-${i}`,
        tagName: 'SECTION',
        label: `Section ${i} with a fairly long label for testing`,
        summary: 'A'.repeat(200),
        isVisible: true,
        visibilityRatio: 1,
        score: 100 - i,
        hasInteractiveElements: false,
        depth: 1,
      }));

      const largeModel: PageModel = {
        ...mockPageModel,
        sections: largeSections,
        scanMetadata: {
          totalSectionsFound: 100,
          sectionsIncluded: 100,
          totalNodesScanned: 1000,
          scanBudgetExhausted: false,
        },
      };

      const prompt = cm.buildSystemPrompt(largeModel, mockTools);
      expect(prompt.length).toBeLessThanOrEqual(6000);
    });

    it('respects a custom token budget — trims optional sections', () => {
      // The essential sections (role, current page, viewport, guidelines) take
      // a baseline amount of space. A budget of 2000 is enough for essentials
      // but forces trimming of optional sections like page sections and navigation.
      const customBudget = new ContextManager({ tokenBudget: 2000 });

      // Build a model with enough optional content to exceed 2000 chars untrimmed
      const largeNavModel: PageModel = {
        ...mockPageModel,
        navigation: Array.from({ length: 30 }, (_, i) => ({
          label: `Link ${i} with a longer label`,
          href: `/page-${i}`,
          isCurrent: i === 0,
          selector: `nav a:nth-child(${i + 1})`,
        })),
      };

      const prompt = customBudget.buildSystemPrompt(largeNavModel, mockTools);
      expect(prompt.length).toBeLessThanOrEqual(2000);
    });
  });

  // -----------------------------------------------------------------------
  // Conversation history
  // -----------------------------------------------------------------------

  describe('addTurn() / getHistory()', () => {
    it('adds a conversation turn', () => {
      const turn = makeTurn('user', 'Hello');
      cm.addTurn(turn);

      const history = cm.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0]).toEqual(turn);
    });

    it('returns history in insertion order', () => {
      const t1 = makeTurn('user', 'First', 1000);
      const t2 = makeTurn('assistant', 'Second', 2000);
      const t3 = makeTurn('user', 'Third', 3000);

      cm.addTurn(t1);
      cm.addTurn(t2);
      cm.addTurn(t3);

      const history = cm.getHistory();
      expect(history).toHaveLength(3);
      expect(history[0]!.content).toBe('First');
      expect(history[1]!.content).toBe('Second');
      expect(history[2]!.content).toBe('Third');
    });

    it('returns a copy — mutating returned array does not affect internal state', () => {
      cm.addTurn(makeTurn('user', 'Hello'));
      const history = cm.getHistory();
      history.push(makeTurn('assistant', 'Injected'));

      expect(cm.getHistory()).toHaveLength(1);
    });

    it('limits history to maxTurns (default 20) — oldest turns summarised', () => {
      const manager = new ContextManager({ maxTurns: 20 });

      for (let i = 0; i < 25; i++) {
        const role = i % 2 === 0 ? 'user' : 'assistant';
        manager.addTurn(makeTurn(role as 'user' | 'assistant', `Message ${i}`, i * 1000));
      }

      const history = manager.getHistory();
      expect(history.length).toBeLessThanOrEqual(20);

      // The oldest entries should have been summarised into a recap turn
      const hasRecap = history.some((t) => t.content.includes('[Conversation recap]'));
      expect(hasRecap).toBe(true);
    });

    it('summarises oldest half when history exceeds 80% of maxTurns', () => {
      const manager = new ContextManager({ maxTurns: 10 });

      // Add 9 turns (>80% of 10 = 8), which triggers summarisation
      for (let i = 0; i < 9; i++) {
        const role = i % 2 === 0 ? 'user' : 'assistant';
        manager.addTurn(makeTurn(role as 'user' | 'assistant', `Turn ${i}`, i * 1000));
      }

      const history = manager.getHistory();
      const recap = history.find((t) => t.content.includes('[Conversation recap]'));
      expect(recap).toBeDefined();
      // The recap should contain information from the old turns
      expect(recap!.content).toContain('Turn 0');
    });
  });

  describe('clearHistory()', () => {
    it('empties the history', () => {
      cm.addTurn(makeTurn('user', 'Hello'));
      cm.addTurn(makeTurn('assistant', 'Hi'));
      expect(cm.getHistory()).toHaveLength(2);

      cm.clearHistory();
      expect(cm.getHistory()).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Content map
  // -----------------------------------------------------------------------

  describe('getContent()', () => {
    it('with static content map returns the entry', async () => {
      const entry: ContentMapEntry = {
        description: 'Hero section description',
        facts: ['This is the hero'],
      };
      const manager = new ContextManager({
        contentMap: { hero: entry },
      });

      const result = await manager.getContent('hero');
      expect(result).toEqual(entry);
    });

    it('with function content map calls the function', async () => {
      const fn = vi.fn((sectionId: string) => {
        if (sectionId === 'hero') {
          return { description: 'Dynamic hero content' };
        }
        return null;
      });

      const manager = new ContextManager({ contentMap: fn });
      const result = await manager.getContent('hero');

      expect(fn).toHaveBeenCalledWith('hero');
      expect(result).toEqual({ description: 'Dynamic hero content' });
    });

    it('with async function handles timeout (2s) and returns null', async () => {
      const slowFn = vi.fn(
        (_sectionId: string) =>
          new Promise<ContentMapEntry | null>((resolve) => {
            // Resolve after 3 seconds — should be killed by the 2s timeout
            setTimeout(() => resolve({ description: 'Too slow' }), 3000);
          }),
      );

      const manager = new ContextManager({ contentMap: slowFn });
      const result = await manager.getContent('hero');

      expect(slowFn).toHaveBeenCalledWith('hero');
      expect(result).toBeNull();
    }, 5000);

    it('caches results for 30s', async () => {
      const fn = vi.fn((sectionId: string) => {
        return { description: `Content for ${sectionId}` };
      });

      const manager = new ContextManager({ contentMap: fn });

      // First call — should invoke the function
      await manager.getContent('hero');
      expect(fn).toHaveBeenCalledTimes(1);

      // Second call — should use cache
      const cached = await manager.getContent('hero');
      expect(fn).toHaveBeenCalledTimes(1); // Not called again
      expect(cached).toEqual({ description: 'Content for hero' });
    });

    it('cache expires after 30s', async () => {
      vi.useFakeTimers();

      const fn = vi.fn((_sectionId: string) => {
        return { description: 'Fresh content' };
      });

      const manager = new ContextManager({ contentMap: fn });

      await manager.getContent('hero');
      expect(fn).toHaveBeenCalledTimes(1);

      // Advance time by 31 seconds — cache should be expired
      vi.advanceTimersByTime(31_000);

      await manager.getContent('hero');
      expect(fn).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('returns null for unknown section with no content map', async () => {
      const manager = new ContextManager();
      const result = await manager.getContent('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null for unknown section in static content map', async () => {
      const manager = new ContextManager({
        contentMap: { hero: { description: 'Hero' } },
      });
      const result = await manager.getContent('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null when function content map throws', async () => {
      const errorFn = vi.fn((_sectionId: string) => {
        throw new Error('Lookup failed');
      });

      const manager = new ContextManager({ contentMap: errorFn });
      const result = await manager.getContent('hero');
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Session persistence
  // -----------------------------------------------------------------------

  describe('saveSession() / restoreSession()', () => {
    let originalWindow: typeof globalThis.window;
    let mockStorage: Record<string, string>;

    beforeEach(() => {
      mockStorage = {};
      originalWindow = globalThis.window;

      // Provide a minimal window with sessionStorage for jsdom
      Object.defineProperty(globalThis, 'window', {
        value: {
          ...globalThis.window,
          location: { href: 'https://example.com/page' },
          sessionStorage: {
            getItem: vi.fn((key: string) => mockStorage[key] ?? null),
            setItem: vi.fn((key: string, value: string) => {
              mockStorage[key] = value;
            }),
            removeItem: vi.fn((key: string) => {
              delete mockStorage[key];
            }),
          },
        },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        writable: true,
        configurable: true,
      });
    });

    it('round-trips correctly via save and restore', () => {
      cm.addTurn(makeTurn('user', 'Hello', 1000));
      cm.addTurn(makeTurn('assistant', 'Hi there!', 2000));

      cm.saveSession();

      // Create a new manager and restore
      const restored = new ContextManager();
      const state = restored.restoreSession();

      expect(state).not.toBeNull();
      expect(state!.conversationHistory).toHaveLength(2);
      expect(state!.conversationHistory[0]!.content).toBe('Hello');
      expect(state!.conversationHistory[1]!.content).toBe('Hi there!');
      expect(state!.currentUrl).toBe('https://example.com/page');

      // Verify the internal history was also restored
      const history = restored.getHistory();
      expect(history).toHaveLength(2);
    });

    it('session persistence size capped at 50KB — oldest turns evicted', () => {
      const manager = new ContextManager({ maxSessionSizeBytes: 50_000 });

      // Add many large turns to exceed 50KB
      for (let i = 0; i < 200; i++) {
        manager.addTurn(
          makeTurn(
            i % 2 === 0 ? 'user' : 'assistant',
            `${'X'.repeat(500)} message ${i}`,
            i * 1000,
          ),
        );
      }

      manager.saveSession();

      const raw = mockStorage['guidekit:session'];
      expect(raw).toBeDefined();

      // The serialised session must fit within 50KB
      const _size = new TextEncoder().encode(raw!).byteLength;
      // The total history serialised within the state should be capped
      const state = JSON.parse(raw!);
      const historySize = new TextEncoder().encode(
        JSON.stringify(state.conversationHistory),
      ).byteLength;
      expect(historySize).toBeLessThanOrEqual(50_000);
    });

    it('restoreSession() returns null when storage contains invalid JSON', () => {
      mockStorage['guidekit:session'] = 'not valid json!!!';
      const result = cm.restoreSession();
      expect(result).toBeNull();
    });

    it('restoreSession() returns null when stored state has wrong shape', () => {
      mockStorage['guidekit:session'] = JSON.stringify({
        foo: 'bar',
      });
      const result = cm.restoreSession();
      expect(result).toBeNull();
    });
  });

  describe('saveSession() — SSR safe', () => {
    it('does nothing when sessionStorage is unavailable', () => {
      const originalWindow = globalThis.window;

      // Simulate SSR: no window
      // @ts-expect-error -- intentionally removing window for SSR test
      delete globalThis.window;

      const manager = new ContextManager();
      manager.addTurn(makeTurn('user', 'Hello'));

      // Should not throw
      expect(() => manager.saveSession()).not.toThrow();

      // Restore
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        writable: true,
        configurable: true,
      });
    });

    it('restoreSession() returns null when sessionStorage is unavailable', () => {
      const originalWindow = globalThis.window;

      // @ts-expect-error -- intentionally removing window for SSR test
      delete globalThis.window;

      const manager = new ContextManager();
      const result = manager.restoreSession();
      expect(result).toBeNull();

      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        writable: true,
        configurable: true,
      });
    });
  });
});
