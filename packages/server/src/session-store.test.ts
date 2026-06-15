import { describe, it, expect } from 'vitest';
import { getSharedSessionStore, InMemorySessionStore } from './session-store.js';

describe('getSharedSessionStore', () => {
  it('returns the same store instance across calls', () => {
    const a = getSharedSessionStore();
    const b = getSharedSessionStore();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(InMemorySessionStore);
  });

  it('persists keys across separate store references', async () => {
    const storeA = getSharedSessionStore();
    const storeB = getSharedSessionStore();
    const expiresAt = Math.floor(Date.now() / 1000) + 900;
    await storeA.set('shared-session', { llmApiKey: 'test-key' }, expiresAt);
    expect(await storeB.get('shared-session')).toEqual({ llmApiKey: 'test-key' });
  });
});
