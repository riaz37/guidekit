/**
 * @module @guidekit/core/cognitive/model-router
 *
 * Selects fast vs primary model tier based on query complexity and mode.
 */

import type { QueryComplexity } from './query-router.js';

export type ModelTier = 'fast' | 'primary';

export interface ModelRouterOptions {
  /** Model id for fast tier (voice, simple queries). */
  fastModel?: string;
  /** Model id for primary tier (complex reasoning). */
  primaryModel?: string;
}

export class ModelRouter {
  private readonly fastModel?: string;
  private readonly primaryModel?: string;

  constructor(options: ModelRouterOptions = {}) {
    this.fastModel = options.fastModel;
    this.primaryModel = options.primaryModel;
  }

  /** Pick model tier without an extra LLM call. */
  select(complexity: QueryComplexity, voiceMode: boolean): ModelTier {
    if (voiceMode) return 'fast';
    if (complexity === 'complex') return 'primary';
    if (complexity === 'moderate') return 'primary';
    return 'fast';
  }

  /** Resolve configured model name for a tier. */
  resolveModel(tier: ModelTier, fallback?: string): string | undefined {
    if (tier === 'fast') return this.fastModel ?? fallback;
    return this.primaryModel ?? fallback;
  }
}
