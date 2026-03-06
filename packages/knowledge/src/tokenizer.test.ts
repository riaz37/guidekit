import { describe, it, expect } from 'vitest';
import { tokenize, removeStopwords } from './tokenizer.js';

describe('tokenize', () => {
  it('lowercases text', () => {
    const tokens = tokenize('Hello World');
    expect(tokens).toEqual(['hello', 'world']);
  });

  it('splits on non-word characters', () => {
    const tokens = tokenize('foo-bar baz_qux, hello!');
    expect(tokens).toEqual(['foo', 'bar', 'baz_qux', 'hello']);
  });

  it('filters empty strings', () => {
    const tokens = tokenize('  hello   world  ');
    expect(tokens.every((t) => t.length > 0)).toBe(true);
    expect(tokens).toEqual(['hello', 'world']);
  });

  it('handles empty input', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('removeStopwords', () => {
  it('removes common English stopwords', () => {
    const tokens = ['the', 'cat', 'is', 'a', 'happy', 'animal'];
    const result = removeStopwords(tokens);
    expect(result).not.toContain('the');
    expect(result).not.toContain('is');
    expect(result).not.toContain('a');
  });

  it('preserves content words', () => {
    const tokens = ['the', 'cat', 'is', 'a', 'happy', 'animal'];
    const result = removeStopwords(tokens);
    expect(result).toEqual(['cat', 'happy', 'animal']);
  });

  it('returns empty array when all words are stopwords', () => {
    const tokens = ['the', 'is', 'a', 'an', 'and', 'or'];
    expect(removeStopwords(tokens)).toEqual([]);
  });

  it('returns all words when none are stopwords', () => {
    const tokens = ['cat', 'dog', 'happy'];
    expect(removeStopwords(tokens)).toEqual(['cat', 'dog', 'happy']);
  });
});
