/**
 * @module @guidekit/core/rendering
 *
 * Theme Engine — resolves GuideKitTheme into CSS custom properties.
 * Supports light/dark modes and developer-supplied token overrides.
 */

import type { GuideKitTheme } from '../types/index.js';

// Default token values for light and dark modes
const LIGHT_TOKENS: Record<string, string> = {
  '--gk-bg': '#ffffff',
  '--gk-bg-secondary': '#f4f4f5',
  '--gk-bg-code': '#f4f4f5',
  '--gk-text-color': '#18181b',
  '--gk-text-secondary': '#71717a',
  '--gk-border-color': '#e4e4e7',
  '--gk-link-color': '#2563eb',
  '--gk-primary': '#4a9eed',
  '--gk-shadow': '0 4px 12px rgba(0,0,0,0.1)',
};

const DARK_TOKENS: Record<string, string> = {
  '--gk-bg': '#1e1e2e',
  '--gk-bg-secondary': '#2a2a3c',
  '--gk-bg-code': '#2a2a3c',
  '--gk-text-color': '#e4e4e7',
  '--gk-text-secondary': '#a1a1aa',
  '--gk-border-color': '#3f3f56',
  '--gk-link-color': '#60a5fa',
  '--gk-primary': '#6aa3e8',
  '--gk-shadow': '0 4px 12px rgba(0,0,0,0.3)',
};

export class ThemeEngine {
  private colorScheme: 'light' | 'dark' | 'auto';
  private userTokens: Record<string, string>;
  private primaryColor?: string;
  private mediaQuery: MediaQueryList | null = null;

  constructor(theme?: GuideKitTheme) {
    this.colorScheme = theme?.colorScheme ?? 'light';
    this.primaryColor = theme?.primaryColor;
    this.userTokens = theme?.tokens ?? {};
  }

  /** Get the resolved CSS tokens for the current mode. */
  resolve(): Record<string, string> {
    const isDark = this.isDarkMode();
    const baseTokens = isDark ? { ...DARK_TOKENS } : { ...LIGHT_TOKENS };

    // Override primary color if set via legacy prop
    if (this.primaryColor) {
      baseTokens['--gk-primary'] = this.primaryColor;
    }

    // Apply user token overrides
    return { ...baseTokens, ...this.userTokens };
  }

  /** Apply tokens as CSS custom properties on an element (typically shadow host). */
  applyTo(element: HTMLElement): void {
    const tokens = this.resolve();
    for (const [key, value] of Object.entries(tokens)) {
      element.style.setProperty(key, value);
    }
  }

  /** Whether the resolved mode is dark. */
  isDarkMode(): boolean {
    if (this.colorScheme === 'dark') return true;
    if (this.colorScheme === 'light') return false;
    // 'auto' — check system preference
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /** Listen for system theme changes when colorScheme is 'auto'. Returns cleanup function. */
  watchSystemTheme(callback: (isDark: boolean) => void): () => void {
    if (this.colorScheme !== 'auto' || typeof window === 'undefined') {
      return () => {};
    }
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => callback(e.matches);
    this.mediaQuery.addEventListener('change', handler);
    return () => {
      this.mediaQuery?.removeEventListener('change', handler);
      this.mediaQuery = null;
    };
  }

  /** Update the theme at runtime. */
  update(theme: Partial<GuideKitTheme>): void {
    if (theme.colorScheme !== undefined) this.colorScheme = theme.colorScheme;
    if (theme.primaryColor !== undefined) this.primaryColor = theme.primaryColor;
    if (theme.tokens !== undefined) this.userTokens = theme.tokens;
  }

  destroy(): void {
    this.mediaQuery = null;
  }
}

export { LIGHT_TOKENS, DARK_TOKENS };
