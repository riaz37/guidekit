// ---------------------------------------------------------------------------
// ThemeEngine – Unit Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ThemeEngine, LIGHT_TOKENS, DARK_TOKENS } from './theme-engine.js';

describe('ThemeEngine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Light mode ────────────────────────────────────────────────────────

  describe('light mode', () => {
    it('returns light tokens by default', () => {
      const engine = new ThemeEngine();
      const tokens = engine.resolve();
      expect(tokens['--gk-bg']).toBe(LIGHT_TOKENS['--gk-bg']);
      expect(tokens['--gk-text-color']).toBe(LIGHT_TOKENS['--gk-text-color']);
    });

    it('returns light tokens when colorScheme is "light"', () => {
      const engine = new ThemeEngine({ colorScheme: 'light' });
      const tokens = engine.resolve();
      expect(tokens['--gk-bg']).toBe('#ffffff');
      expect(tokens['--gk-text-color']).toBe('#18181b');
    });

    it('isDarkMode returns false for light mode', () => {
      const engine = new ThemeEngine({ colorScheme: 'light' });
      expect(engine.isDarkMode()).toBe(false);
    });
  });

  // ── Dark mode ─────────────────────────────────────────────────────────

  describe('dark mode', () => {
    it('returns dark tokens when colorScheme is "dark"', () => {
      const engine = new ThemeEngine({ colorScheme: 'dark' });
      const tokens = engine.resolve();
      expect(tokens['--gk-bg']).toBe(DARK_TOKENS['--gk-bg']);
      expect(tokens['--gk-text-color']).toBe(DARK_TOKENS['--gk-text-color']);
    });

    it('isDarkMode returns true for dark mode', () => {
      const engine = new ThemeEngine({ colorScheme: 'dark' });
      expect(engine.isDarkMode()).toBe(true);
    });
  });

  // ── Auto mode ─────────────────────────────────────────────────────────

  describe('auto mode', () => {
    it('detects system dark mode via matchMedia', () => {
      vi.spyOn(window, 'matchMedia').mockReturnValue({
        matches: true,
        media: '(prefers-color-scheme: dark)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as MediaQueryList);

      const engine = new ThemeEngine({ colorScheme: 'auto' });
      expect(engine.isDarkMode()).toBe(true);
      const tokens = engine.resolve();
      expect(tokens['--gk-bg']).toBe(DARK_TOKENS['--gk-bg']);
    });

    it('detects system light mode via matchMedia', () => {
      vi.spyOn(window, 'matchMedia').mockReturnValue({
        matches: false,
        media: '(prefers-color-scheme: dark)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as MediaQueryList);

      const engine = new ThemeEngine({ colorScheme: 'auto' });
      expect(engine.isDarkMode()).toBe(false);
      const tokens = engine.resolve();
      expect(tokens['--gk-bg']).toBe(LIGHT_TOKENS['--gk-bg']);
    });
  });

  // ── Custom token overrides ────────────────────────────────────────────

  describe('custom tokens', () => {
    it('merges user-supplied token overrides', () => {
      const engine = new ThemeEngine({
        colorScheme: 'light',
        tokens: { '--gk-bg': '#ff0000', '--custom-var': 'blue' },
      });
      const tokens = engine.resolve();
      expect(tokens['--gk-bg']).toBe('#ff0000');
      expect(tokens['--custom-var']).toBe('blue');
      // Other tokens should still be present
      expect(tokens['--gk-text-color']).toBe(LIGHT_TOKENS['--gk-text-color']);
    });
  });

  // ── Primary color override ────────────────────────────────────────────

  describe('primaryColor', () => {
    it('overrides --gk-primary with primaryColor', () => {
      const engine = new ThemeEngine({
        colorScheme: 'light',
        primaryColor: '#00ff00',
      });
      const tokens = engine.resolve();
      expect(tokens['--gk-primary']).toBe('#00ff00');
    });

    it('user tokens take precedence over primaryColor', () => {
      const engine = new ThemeEngine({
        primaryColor: '#00ff00',
        tokens: { '--gk-primary': '#0000ff' },
      });
      const tokens = engine.resolve();
      // tokens override comes after primaryColor in the spread
      expect(tokens['--gk-primary']).toBe('#0000ff');
    });
  });

  // ── applyTo() ─────────────────────────────────────────────────────────

  describe('applyTo()', () => {
    it('sets CSS custom properties on an element', () => {
      const engine = new ThemeEngine({ colorScheme: 'light' });
      const el = document.createElement('div');
      engine.applyTo(el);
      expect(el.style.getPropertyValue('--gk-bg')).toBe('#ffffff');
      expect(el.style.getPropertyValue('--gk-text-color')).toBe('#18181b');
    });
  });

  // ── update() ──────────────────────────────────────────────────────────

  describe('update()', () => {
    it('updates colorScheme at runtime', () => {
      const engine = new ThemeEngine({ colorScheme: 'light' });
      expect(engine.isDarkMode()).toBe(false);
      engine.update({ colorScheme: 'dark' });
      expect(engine.isDarkMode()).toBe(true);
    });

    it('updates primaryColor at runtime', () => {
      const engine = new ThemeEngine({ colorScheme: 'light' });
      engine.update({ primaryColor: '#abcdef' });
      const tokens = engine.resolve();
      expect(tokens['--gk-primary']).toBe('#abcdef');
    });

    it('updates custom tokens at runtime', () => {
      const engine = new ThemeEngine({ colorScheme: 'light' });
      engine.update({ tokens: { '--gk-bg': '#111' } });
      const tokens = engine.resolve();
      expect(tokens['--gk-bg']).toBe('#111');
    });
  });

  // ── watchSystemTheme() ────────────────────────────────────────────────

  describe('watchSystemTheme()', () => {
    it('returns noop cleanup for non-auto mode', () => {
      const engine = new ThemeEngine({ colorScheme: 'light' });
      const cleanup = engine.watchSystemTheme(vi.fn());
      expect(typeof cleanup).toBe('function');
      cleanup(); // should not throw
    });

    it('registers change listener for auto mode', () => {
      const addEventListener = vi.fn();
      const removeEventListener = vi.fn();
      vi.spyOn(window, 'matchMedia').mockReturnValue({
        matches: false,
        media: '(prefers-color-scheme: dark)',
        addEventListener,
        removeEventListener,
      } as unknown as MediaQueryList);

      const engine = new ThemeEngine({ colorScheme: 'auto' });
      const callback = vi.fn();
      const cleanup = engine.watchSystemTheme(callback);

      expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

      cleanup();
      expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });
  });

  // ── destroy() ─────────────────────────────────────────────────────────

  describe('destroy()', () => {
    it('can be called without error', () => {
      const engine = new ThemeEngine();
      expect(() => engine.destroy()).not.toThrow();
    });
  });
});
