import { describe, it, expect, afterEach } from 'vitest';
import { ErrorDetector } from './error-detector';

// Polyfill CSS.escape for jsdom
if (typeof globalThis.CSS === 'undefined') {
  (globalThis as Record<string, unknown>).CSS = {} as typeof CSS;
}
if (typeof CSS.escape !== 'function') {
  CSS.escape = (value: string): string => {
    // eslint-disable-next-line no-control-regex
    return value.replace(/([\0-\x1f\x7f]|^[0-9]|[-](?=[0-9]))/g, '\\$&')
      .replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  };
}

function createFixture(html: string): Element {
  const div = document.createElement('div');
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ErrorDetector', () => {
  const detector = new ErrorDetector();

  // -----------------------------------------------------------------------
  // ARIA-based detection
  // -----------------------------------------------------------------------
  describe('aria-invalid fields', () => {
    it('detects aria-invalid="true" fields with associated error message', () => {
      const root = createFixture(`
        <form>
          <label for="email">Email</label>
          <input id="email" aria-invalid="true" aria-errormessage="email-error" type="email" value="bad" />
          <span id="email-error" class="error">Invalid email address</span>
        </form>
      `);
      const errors = detector.detect(root);
      expect(errors.length).toBeGreaterThanOrEqual(1);
      const invalid = errors.find((e) => e.message.includes('Invalid email'));
      expect(invalid).toBeDefined();
      expect(invalid!.severity).toBe('error');
    });
  });

  describe('role="alert" elements', () => {
    it('detects role="alert" elements with text', () => {
      const root = createFixture(`
        <div role="alert">Something went wrong. Please try again.</div>
      `);
      const errors = detector.detect(root);
      expect(errors.length).toBeGreaterThanOrEqual(1);
      const alert = errors.find((e) => e.message.includes('Something went wrong'));
      expect(alert).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Class-based detection
  // -----------------------------------------------------------------------
  describe('error class patterns', () => {
    it('detects .error class', () => {
      const root = createFixture(`
        <div class="error">Username is required</div>
      `);
      const errors = detector.detect(root);
      expect(errors.length).toBeGreaterThanOrEqual(1);
    });

    it('detects .invalid class', () => {
      const root = createFixture(`
        <span class="invalid">Password too short</span>
      `);
      const errors = detector.detect(root);
      expect(errors.length).toBeGreaterThanOrEqual(1);
    });

    it('detects .has-error class', () => {
      const root = createFixture(`
        <div class="has-error">
          <input type="text" />
          <span>This field is required</span>
        </div>
      `);
      const errors = detector.detect(root);
      expect(errors.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // Severity classification
  // -----------------------------------------------------------------------
  describe('severity classification', () => {
    it('classifies error class as severity "error"', () => {
      const root = createFixture(`
        <div class="error">Critical failure</div>
      `);
      const errors = detector.detect(root);
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors[0]!.severity).toBe('error');
    });

    it('classifies warning class as severity "warning"', () => {
      // Must also match an error detection selector (role="alert")
      // while having a warning class for severity classification
      const root = createFixture(`
        <div role="alert" class="warning">Disk space low</div>
      `);
      const errors = detector.detect(root);
      const warning = errors.find((e) => e.severity === 'warning');
      expect(warning).toBeDefined();
    });

    it('classifies info class as severity "info"', () => {
      // Must also match an error detection selector (role="alert")
      // while having an info class for severity classification
      const root = createFixture(`
        <div role="alert" class="info">Your session will expire soon</div>
      `);
      const errors = detector.detect(root);
      const info = errors.find((e) => e.severity === 'info');
      expect(info).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Dismissible detection
  // -----------------------------------------------------------------------
  describe('dismissible detection', () => {
    it('detects dismissible errors with close button', () => {
      const root = createFixture(`
        <div class="error" id="err1">
          Something failed
          <button aria-label="Close">X</button>
        </div>
      `);
      const errors = detector.detect(root);
      const dismissible = errors.find((e) => e.dismissible === true);
      expect(dismissible).toBeDefined();
    });

    it('marks errors without close button as not dismissible', () => {
      const root = createFixture(`
        <div class="error">Not dismissible error</div>
      `);
      const errors = detector.detect(root);
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors[0]!.dismissible).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Related field linking
  // -----------------------------------------------------------------------
  describe('related field linking', () => {
    it('links form errors to related fields via aria-describedby', () => {
      const root = createFixture(`
        <form>
          <input id="name" aria-describedby="name-error" type="text" />
          <span id="name-error" class="error">Name is required</span>
        </form>
      `);
      const errors = detector.detect(root);
      const nameError = errors.find((e) => e.message.includes('Name is required'));
      expect(nameError).toBeDefined();
      expect(nameError!.relatedField).toBeDefined();
    });

    it('links form errors to related fields by walking up to form group', () => {
      const root = createFixture(`
        <div class="form-group">
          <input type="text" id="username" />
          <span class="error">Username taken</span>
        </div>
      `);
      const errors = detector.detect(root);
      const err = errors.find((e) => e.message.includes('Username taken'));
      expect(err).toBeDefined();
      expect(err!.relatedField).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Clean page
  // -----------------------------------------------------------------------
  describe('clean page', () => {
    it('returns empty array for clean pages', () => {
      const root = createFixture(`
        <div>
          <h1>Welcome</h1>
          <p>Everything is fine.</p>
          <button>Continue</button>
        </div>
      `);
      const errors = detector.detect(root);
      expect(errors).toEqual([]);
    });
  });
});
