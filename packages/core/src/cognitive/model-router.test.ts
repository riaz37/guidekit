import { describe, it, expect } from 'vitest';
import { ModelRouter } from './model-router.js';

describe('ModelRouter', () => {
  it('prefers fast tier for simple queries', () => {
    const router = new ModelRouter({ fastModel: 'flash', primaryModel: 'pro' });
    expect(router.select('simple', false)).toBe('fast');
    expect(router.resolveModel('fast', 'default')).toBe('flash');
  });

  it('uses primary tier for complex queries', () => {
    const router = new ModelRouter({ fastModel: 'flash', primaryModel: 'pro' });
    expect(router.select('complex', false)).toBe('primary');
    expect(router.resolveModel('primary', 'default')).toBe('pro');
  });

  it('prefers fast tier in voice mode regardless of complexity', () => {
    const router = new ModelRouter();
    expect(router.select('complex', true)).toBe('fast');
  });
});
