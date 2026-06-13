import { describe, it, expect } from 'vitest';
import { QueryRouter } from './query-router.js';

describe('QueryRouter', () => {
  it('classifies simple highlight requests', () => {
    const router = new QueryRouter();
    expect(router.classify('highlight the submit button')).toBe('simple');
  });

  it('classifies multi-step requests as complex', () => {
    const router = new QueryRouter();
    expect(
      router.classify('Walk me through this 4-step checkout process step by step'),
    ).toBe('complex');
  });
});
