/**
 * @module @guidekit/core/context/token-budget
 *
 * Token-aware budget management with optional js-tiktoken and char fallback.
 */

export type TokenizerProvider = 'openai' | 'gemini' | 'anthropic' | 'heuristic';

export interface TokenBudgetOptions {
  maxTokens?: number;
  provider?: TokenizerProvider;
}

export interface CompressionResult {
  text: string;
  tokensBefore: number;
  tokensAfter: number;
  strategy: 'none' | 'truncate-history' | 'truncate-sections' | 'drop-low-priority';
}

let tiktokenLoader: Promise<typeof import('js-tiktoken') | null> | null = null;

async function loadTiktoken(): Promise<typeof import('js-tiktoken') | null> {
  if (!tiktokenLoader) {
    tiktokenLoader = import('js-tiktoken').catch(() => null);
  }
  return tiktokenLoader;
}

/** Sync token estimate (CJK-aware). Used when js-tiktoken is unavailable. */
export function heuristicCount(text: string): number {
  let cjk = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0x4e00 && code <= 0x9fff) cjk += 1;
  }
  const nonCjk = text.length - cjk;
  return Math.ceil(nonCjk / 4 + cjk / 1.5);
}

export class TokenBudgetManager {
  private readonly maxTokens: number;
  private readonly provider: TokenizerProvider;
  private encoder: { encode: (text: string) => number[] } | null = null;

  constructor(options: TokenBudgetOptions = {}) {
    this.maxTokens = options.maxTokens ?? 4_000;
    this.provider = options.provider ?? 'heuristic';
  }

  async init(): Promise<void> {
    if (this.provider === 'openai') {
      const mod = await loadTiktoken();
      if (mod) {
        this.encoder = mod.encodingForModel('gpt-4o-mini');
      }
    }
  }

  count(text: string): number {
    if (this.encoder) return this.encoder.encode(text).length;
    return heuristicCount(text);
  }

  fits(text: string): boolean {
    return this.count(text) <= this.maxTokens;
  }

  /**
   * Progressive compression: truncate from end of history sections first.
   */
  compress(text: string, sections: string[]): CompressionResult {
    const before = this.count(text);
    if (before <= this.maxTokens) {
      return { text, tokensBefore: before, tokensAfter: before, strategy: 'none' };
    }

    const working = [...sections];
    let combined = working.join('\n\n');
    let after = this.count(combined);

    while (working.length > 1 && after > this.maxTokens) {
      working.pop();
      combined = working.join('\n\n');
      after = this.count(combined);
    }

    if (after <= this.maxTokens) {
      return {
        text: combined,
        tokensBefore: before,
        tokensAfter: after,
        strategy: 'truncate-sections',
      };
    }

    const truncated = combined.slice(0, this.maxTokens * 4);
    return {
      text: truncated,
      tokensBefore: before,
      tokensAfter: this.count(truncated),
      strategy: 'truncate-history',
    };
  }
}
