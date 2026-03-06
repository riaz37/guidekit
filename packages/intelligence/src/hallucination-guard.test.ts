import { describe, it, expect } from 'vitest';
import { HallucinationGuard } from './hallucination-guard';
import type { PageModel } from '@guidekit/core';

/** Minimal valid PageModel for testing. */
function createMockPageModel(
  overrides: Partial<PageModel> = {},
): PageModel {
  return {
    url: 'https://example.com',
    title: 'Test Page',
    meta: {
      description: 'A test page',
      h1: 'Test',
      language: 'en',
    },
    sections: [],
    navigation: [
      { label: 'Dashboard', href: '/dashboard', isCurrent: false, selector: 'a[href="/dashboard"]' },
      { label: 'Settings', href: '/settings', isCurrent: true, selector: 'a[href="/settings"]' },
      { label: 'Profile', href: '/profile', isCurrent: false, selector: 'a[href="/profile"]' },
    ],
    interactiveElements: [
      { selector: '#submit', tagName: 'BUTTON', label: 'Submit', role: 'button', isDisabled: false },
      { selector: '#cancel', tagName: 'BUTTON', label: 'Cancel', role: 'button', isDisabled: false },
      { selector: '#search-input', tagName: 'INPUT', type: 'text', label: 'Search', role: 'searchbox', isDisabled: false },
    ],
    forms: [],
    activeOverlays: [],
    viewport: { width: 1280, height: 720, orientation: 'landscape' },
    allSectionsSummary: [],
    hash: 'test-hash',
    timestamp: Date.now(),
    scanMetadata: {
      totalSectionsFound: 0,
      sectionsIncluded: 0,
      totalNodesScanned: 0,
      scanBudgetExhausted: false,
    },
    ...overrides,
  };
}

describe('HallucinationGuard', () => {
  const guard = new HallucinationGuard();

  // -----------------------------------------------------------------------
  // Valid responses
  // -----------------------------------------------------------------------
  describe('valid responses', () => {
    it('valid response with matching element references returns isValid: true', () => {
      const model = createMockPageModel();
      const response = 'Click the "Submit" button to save your changes.';
      const result = guard.validate(response, model);
      expect(result.isValid).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.issues).toHaveLength(0);
    });

    it('response with no element references returns isValid: true', () => {
      const model = createMockPageModel();
      const response = 'Your account has been updated successfully.';
      const result = guard.validate(response, model);
      expect(result.isValid).toBe(true);
      expect(result.confidence).toBe(1.0);
      expect(result.issues).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Invalid element reference
  // -----------------------------------------------------------------------
  describe('invalid element references', () => {
    it('invalid element reference returns isValid: false with high severity', () => {
      const model = createMockPageModel();
      const response = 'Click the "Download" button to get the file.';
      const result = guard.validate(response, model);
      expect(result.isValid).toBe(false);
      const elementIssue = result.issues.find(
        (i) => i.type === 'element-reference' && i.severity === 'high',
      );
      expect(elementIssue).toBeDefined();
      expect(elementIssue!.claim).toBe('Download');
    });

    it('suggestion includes available elements', () => {
      const model = createMockPageModel();
      const response = 'Click the "Delete" button.';
      const result = guard.validate(response, model);
      const issue = result.issues.find((i) => i.type === 'element-reference');
      expect(issue).toBeDefined();
      expect(issue!.suggestion).toContain('Submit');
      expect(issue!.suggestion).toContain('Cancel');
    });
  });

  // -----------------------------------------------------------------------
  // Invalid navigation reference
  // -----------------------------------------------------------------------
  describe('invalid navigation references', () => {
    it('invalid navigation reference returns medium severity issue', () => {
      const model = createMockPageModel();
      const response = 'Navigate to the "Reports" page to see your data.';
      const result = guard.validate(response, model);
      const navIssue = result.issues.find(
        (i) => i.type === 'navigation-reference',
      );
      expect(navIssue).toBeDefined();
      expect(navIssue!.severity).toBe('medium');
      expect(navIssue!.claim).toBe('Reports');
    });

    it('valid navigation reference passes without issues', () => {
      const model = createMockPageModel();
      const response = 'Go to "Dashboard" to see your overview.';
      const result = guard.validate(response, model);
      const navIssues = result.issues.filter(
        (i) => i.type === 'navigation-reference',
      );
      expect(navIssues).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Confidence scoring
  // -----------------------------------------------------------------------
  describe('confidence scoring', () => {
    it('confidence decreases with more issues', () => {
      const model = createMockPageModel();
      // Single invalid ref
      const result1 = guard.validate('Click the "NonExistent" button.', model);
      // Two invalid refs
      const result2 = guard.validate(
        'Click the "NonExistent" button then press the "FakeAction" button.',
        model,
      );
      expect(result2.confidence).toBeLessThan(result1.confidence);
    });

    it('confidence is at least 0', () => {
      const model = createMockPageModel();
      // Many invalid references to drive confidence very low
      const response = [
        'Click the "AAA" button.',
        'Click the "BBB" button.',
        'Click the "CCC" button.',
        'Click the "DDD" button.',
        'Click the "EEE" button.',
      ].join(' ');
      const result = guard.validate(response, model);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });
  });

  // -----------------------------------------------------------------------
  // Case-insensitive matching
  // -----------------------------------------------------------------------
  describe('case-insensitive matching', () => {
    it('matches element labels case-insensitively', () => {
      const model = createMockPageModel();
      // "submit" should match "Submit"
      const response = 'Click the "submit" button to proceed.';
      const result = guard.validate(response, model);
      const elementIssues = result.issues.filter(
        (i) => i.type === 'element-reference',
      );
      expect(elementIssues).toHaveLength(0);
    });

    it('matches navigation labels case-insensitively', () => {
      const model = createMockPageModel();
      const response = 'Go to "dashboard" for an overview.';
      const result = guard.validate(response, model);
      const navIssues = result.issues.filter(
        (i) => i.type === 'navigation-reference',
      );
      expect(navIssues).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // HallucinationResult shape
  // -----------------------------------------------------------------------
  describe('result shape', () => {
    it('returns correct HallucinationResult shape', () => {
      const model = createMockPageModel();
      const result = guard.validate('Hello world', model);
      expect(result).toHaveProperty('isValid');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('issues');
      expect(typeof result.isValid).toBe('boolean');
      expect(typeof result.confidence).toBe('number');
      expect(Array.isArray(result.issues)).toBe(true);
    });
  });
});
