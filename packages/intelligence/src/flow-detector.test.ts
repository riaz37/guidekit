import { describe, it, expect, afterEach } from 'vitest';
import { FlowDetector } from './flow-detector';

function createFixture(html: string): Element {
  const div = document.createElement('div');
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('FlowDetector', () => {
  const detector = new FlowDetector();

  // -----------------------------------------------------------------------
  // Text pattern detection ("Step X of Y")
  // -----------------------------------------------------------------------
  describe('text patterns', () => {
    it('detects "Step X of Y" text patterns', () => {
      const root = createFixture(`
        <div>
          <span>Step 2 of 5</span>
          <div>Form content here</div>
        </div>
      `);
      const flow = detector.detect(root);
      expect(flow).not.toBeNull();
      expect(flow!.currentStep).toBe(2);
      expect(flow!.totalSteps).toBe(5);
    });

    it('detects "Page X/Y" text patterns', () => {
      const root = createFixture(`
        <div>
          <p>Page 3/7</p>
          <div>Survey content</div>
        </div>
      `);
      const flow = detector.detect(root);
      expect(flow).not.toBeNull();
      expect(flow!.currentStep).toBe(3);
      expect(flow!.totalSteps).toBe(7);
    });
  });

  // -----------------------------------------------------------------------
  // Progressbar detection
  // -----------------------------------------------------------------------
  describe('progressbar detection', () => {
    it('detects role="progressbar" with aria-valuenow/max as step counts', () => {
      const root = createFixture(`
        <div role="progressbar" aria-valuenow="3" aria-valuemax="5"></div>
        <div>Checkout step content</div>
      `);
      const flow = detector.detect(root);
      expect(flow).not.toBeNull();
      expect(flow!.currentStep).toBe(3);
      expect(flow!.totalSteps).toBe(5);
    });

    it('returns null for progressbar with invalid values', () => {
      const root = createFixture(`
        <div role="progressbar" aria-valuenow="abc" aria-valuemax="xyz"></div>
      `);
      const flow = detector.detect(root);
      expect(flow).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Step element detection
  // -----------------------------------------------------------------------
  describe('step elements', () => {
    it('detects .step elements', () => {
      const root = createFixture(`
        <div>
          <div class="step completed">Account</div>
          <div class="step active">Shipping</div>
          <div class="step">Payment</div>
        </div>
      `);
      const flow = detector.detect(root);
      expect(flow).not.toBeNull();
      expect(flow!.totalSteps).toBe(3);
      expect(flow!.currentStep).toBe(2);
      expect(flow!.stepLabels).toEqual(['Account', 'Shipping', 'Payment']);
      expect(flow!.completedSteps).toContain(1);
    });

    it('detects .wizard-step elements', () => {
      const root = createFixture(`
        <div>
          <div class="wizard-step done">Info</div>
          <div class="wizard-step active">Review</div>
          <div class="wizard-step">Confirm</div>
        </div>
      `);
      const flow = detector.detect(root);
      expect(flow).not.toBeNull();
      expect(flow!.totalSteps).toBe(3);
    });

    it('detects [data-step] elements', () => {
      const root = createFixture(`
        <div>
          <div data-step="1" class="complete">Step One</div>
          <div data-step="2" aria-current="step">Step Two</div>
          <div data-step="3">Step Three</div>
        </div>
      `);
      const flow = detector.detect(root);
      expect(flow).not.toBeNull();
      expect(flow!.currentStep).toBe(2);
      expect(flow!.totalSteps).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // data-guidekit-flow annotation
  // -----------------------------------------------------------------------
  describe('data-guidekit-flow annotation', () => {
    it('detects annotation with JSON data', () => {
      const root = createFixture(`
        <div data-guidekit-flow='{"type":"checkout","currentStep":2,"totalSteps":4,"stepLabels":["Cart","Shipping","Payment","Confirm"],"completedSteps":[1]}'>
          <div>Step content</div>
        </div>
      `);
      const flow = detector.detect(root);
      expect(flow).not.toBeNull();
      expect(flow!.type).toBe('checkout');
      expect(flow!.currentStep).toBe(2);
      expect(flow!.totalSteps).toBe(4);
      expect(flow!.stepLabels).toEqual(['Cart', 'Shipping', 'Payment', 'Confirm']);
      expect(flow!.completedSteps).toEqual([1]);
    });

    it('handles non-JSON annotation value gracefully', () => {
      const root = createFixture(`
        <div data-guidekit-flow="onboarding">Content</div>
      `);
      const flow = detector.detect(root);
      expect(flow).not.toBeNull();
      expect(flow!.type).toBe('custom');
      expect(flow!.currentStep).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // FlowState shape validation
  // -----------------------------------------------------------------------
  describe('FlowState shape', () => {
    it('returns correct FlowState shape', () => {
      const root = createFixture(`
        <div>
          <div class="step active">One</div>
          <div class="step">Two</div>
          <div class="step">Three</div>
        </div>
      `);
      const flow = detector.detect(root);
      expect(flow).not.toBeNull();
      expect(flow).toHaveProperty('type');
      expect(flow).toHaveProperty('currentStep');
      expect(flow).toHaveProperty('totalSteps');
      expect(flow).toHaveProperty('stepLabels');
      expect(flow).toHaveProperty('completedSteps');
      expect(typeof flow!.type).toBe('string');
      expect(typeof flow!.currentStep).toBe('number');
      expect(typeof flow!.totalSteps).toBe('number');
      expect(Array.isArray(flow!.stepLabels)).toBe(true);
      expect(Array.isArray(flow!.completedSteps)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Flow type classification
  // -----------------------------------------------------------------------
  describe('flow type classification', () => {
    it('classifies checkout flows', () => {
      const root = createFixture(`
        <div>
          <h1>Checkout</h1>
          <div class="step active">Cart</div>
          <div class="step">Payment</div>
        </div>
      `);
      const flow = detector.detect(root);
      expect(flow).not.toBeNull();
      expect(flow!.type).toBe('checkout');
    });

    it('classifies signup flows', () => {
      const root = createFixture(`
        <div>
          <h1>Create Account</h1>
          <div class="step active">Email</div>
          <div class="step">Password</div>
        </div>
      `);
      const flow = detector.detect(root);
      expect(flow).not.toBeNull();
      expect(flow!.type).toBe('signup');
    });

    it('classifies onboarding flows', () => {
      const root = createFixture(`
        <div>
          <h1>Welcome! Get Started</h1>
          <div class="step active">Profile</div>
          <div class="step">Preferences</div>
        </div>
      `);
      const flow = detector.detect(root);
      expect(flow).not.toBeNull();
      expect(flow!.type).toBe('onboarding');
    });

    it('falls back to wizard for unclassified flows', () => {
      const root = createFixture(`
        <div>
          <div class="step active">Phase 1</div>
          <div class="step">Phase 2</div>
          <div class="step">Phase 3</div>
        </div>
      `);
      const flow = detector.detect(root);
      expect(flow).not.toBeNull();
      expect(flow!.type).toBe('wizard');
    });
  });

  // -----------------------------------------------------------------------
  // No flow detected
  // -----------------------------------------------------------------------
  describe('no flow', () => {
    it('returns null when no flow detected', () => {
      const root = createFixture(`
        <div>
          <h1>About Us</h1>
          <p>We are a company that does things.</p>
        </div>
      `);
      const flow = detector.detect(root);
      expect(flow).toBeNull();
    });
  });
});
