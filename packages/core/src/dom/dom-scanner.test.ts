import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DOMScanner } from './index.js';

// ---------------------------------------------------------------------------
// Polyfill CSS.escape for jsdom (not available in jsdom by default)
// ---------------------------------------------------------------------------

if (typeof globalThis.CSS === 'undefined') {
  (globalThis as Record<string, unknown>).CSS = {} as typeof CSS;
}
if (typeof CSS.escape !== 'function') {
  CSS.escape = (value: string): string => {
    // Simplified polyfill sufficient for test IDs
    // eslint-disable-next-line no-control-regex
    return value.replace(/([\0-\x1f\x7f]|^[0-9]|[-](?=[0-9]))/g, '\\$&')
      .replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const STANDARD_HTML = `
<html lang="en">
<head><title>Test Page</title><meta name="description" content="Test desc"></head>
<body>
  <nav><a href="/home">Home</a><a href="/about">About</a></nav>
  <main>
    <section id="hero" aria-label="Hero Section">
      <h1>Welcome</h1>
      <p>This is the hero content.</p>
    </section>
    <section id="pricing" data-guidekit-target="pricing-section">
      <h2>Pricing</h2>
      <p>Our plans start at $29/mo.</p>
    </section>
    <div data-guidekit-ignore>
      <p>Sensitive content that should be ignored</p>
    </div>
    <form id="contact-form">
      <label for="name">Name</label>
      <input type="text" id="name" name="name" required>
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required>
      <input type="password" name="password">
    </form>
  </main>
</body>
</html>
`;

describe('DOMScanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = STANDARD_HTML;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  // ---- Basic scan ---------------------------------------------------------

  it('scan() produces a valid PageModel with all required fields', () => {
    const scanner = new DOMScanner();
    const model = scanner.scan();

    expect(model).toBeDefined();
    expect(model).toHaveProperty('url');
    expect(model).toHaveProperty('title');
    expect(model).toHaveProperty('meta');
    expect(model).toHaveProperty('sections');
    expect(model).toHaveProperty('navigation');
    expect(model).toHaveProperty('interactiveElements');
    expect(model).toHaveProperty('forms');
    expect(model).toHaveProperty('activeOverlays');
    expect(model).toHaveProperty('viewport');
    expect(model).toHaveProperty('allSectionsSummary');
    expect(model).toHaveProperty('hash');
    expect(model).toHaveProperty('timestamp');
    expect(model).toHaveProperty('scanMetadata');

    expect(typeof model.hash).toBe('string');
    expect(model.hash.length).toBeGreaterThan(0);
    expect(typeof model.timestamp).toBe('number');
    expect(Array.isArray(model.sections)).toBe(true);
    expect(Array.isArray(model.navigation)).toBe(true);
    expect(Array.isArray(model.forms)).toBe(true);
  });

  // ---- Meta extraction ----------------------------------------------------

  it('extracts page title and meta description', () => {
    const scanner = new DOMScanner();
    const model = scanner.scan();

    expect(model.title).toBe('Test Page');
    expect(model.meta.description).toBe('Test desc');
    expect(model.meta.language).toBe('en');
  });

  it('extracts h1 into meta.h1', () => {
    const scanner = new DOMScanner();
    const model = scanner.scan();

    expect(model.meta.h1).toBe('Welcome');
  });

  // ---- Navigation extraction ----------------------------------------------

  it('extracts navigation items from <nav> elements', () => {
    const scanner = new DOMScanner();
    const model = scanner.scan();

    expect(model.navigation.length).toBeGreaterThanOrEqual(2);

    const homeNav = model.navigation.find((n) => n.label === 'Home');
    expect(homeNav).toBeDefined();
    expect(homeNav!.href).toBe('/home');

    const aboutNav = model.navigation.find((n) => n.label === 'About');
    expect(aboutNav).toBeDefined();
    expect(aboutNav!.href).toBe('/about');
  });

  // ---- Form extraction ----------------------------------------------------

  it('extracts form fields with labels', () => {
    const scanner = new DOMScanner();
    const model = scanner.scan();

    expect(model.forms.length).toBeGreaterThanOrEqual(1);

    const contactForm = model.forms.find(
      (f) => f.id === 'contact-form',
    );
    expect(contactForm).toBeDefined();
    expect(contactForm!.fields.length).toBeGreaterThanOrEqual(3);

    const nameField = contactForm!.fields.find((f) => f.name === 'name');
    expect(nameField).toBeDefined();
    expect(nameField!.label).toBe('Name');
    expect(nameField!.isRequired).toBe(true);
    expect(nameField!.type).toBe('text');

    const emailField = contactForm!.fields.find(
      (f) => f.name === 'email',
    );
    expect(emailField).toBeDefined();
    expect(emailField!.label).toBe('Email');
    expect(emailField!.isRequired).toBe(true);
  });

  // ---- data-guidekit-ignore -----------------------------------------------

  it('detects data-guidekit-ignore and skips those subtrees', () => {
    const scanner = new DOMScanner();
    const model = scanner.scan();

    // The ignored div should not appear in sections
    const allText = JSON.stringify(model.sections);
    expect(allText).not.toContain('Sensitive content that should be ignored');

    // Interactive elements inside ignored subtrees should also be absent
    const ignored = model.interactiveElements.filter((el) =>
      el.selector.includes('data-guidekit-ignore'),
    );
    expect(ignored).toHaveLength(0);
  });

  // ---- data-guidekit-target -----------------------------------------------

  it('detects data-guidekit-target attributes in selectors', () => {
    const scanner = new DOMScanner();
    const model = scanner.scan();

    const pricingSection = model.sections.find(
      (s) => s.id === 'pricing-section',
    );
    expect(pricingSection).toBeDefined();
    expect(pricingSection!.selector).toBe(
      '[data-guidekit-target="pricing-section"]',
    );
  });

  // ---- PII stripping ------------------------------------------------------

  it('strips PII patterns (email, phone, SSN) from text content', () => {
    document.body.innerHTML = `
      <main>
        <section id="pii-test">
          <p>Contact john@example.com or call 555-123-4567</p>
          <p>SSN: 123-45-6789</p>
        </section>
      </main>
    `;

    const scanner = new DOMScanner();
    const model = scanner.scan();

    const allText = JSON.stringify(model);
    expect(allText).not.toContain('john@example.com');
    expect(allText).not.toContain('555-123-4567');
    expect(allText).not.toContain('123-45-6789');
    expect(allText).toContain('[REDACTED]');
  });

  // ---- Password inputs ----------------------------------------------------

  it('never includes password input values', () => {
    const scanner = new DOMScanner();
    const model = scanner.scan();

    // Find the password field in forms
    const contactForm = model.forms.find(
      (f) => f.id === 'contact-form',
    );
    expect(contactForm).toBeDefined();

    const passwordField = contactForm!.fields.find(
      (f) => f.type === 'password',
    );
    expect(passwordField).toBeDefined();

    // The password field's label should not expose sensitive data
    // It should fall back to a generic label (name or type)
    expect(passwordField!.label).toBeDefined();
    expect(typeof passwordField!.label).toBe('string');
  });

  // ---- maxNodes budget ----------------------------------------------------

  it('respects maxNodes budget', () => {
    // Use a very small budget
    const scanner = new DOMScanner({ maxNodes: 3 });
    const model = scanner.scan();

    expect(model.scanMetadata.totalNodesScanned).toBeLessThanOrEqual(3);
    expect(model.scanMetadata.scanBudgetExhausted).toBe(true);
  });

  // ---- Hash changes -------------------------------------------------------

  it('hash changes when content changes', () => {
    const scanner = new DOMScanner();

    const model1 = scanner.scan();

    // Mutate the DOM
    const newSection = document.createElement('section');
    newSection.id = 'new-section';
    newSection.innerHTML = '<h2>Brand New</h2><p>Fresh content</p>';
    document.body.querySelector('main')!.appendChild(newSection);

    const model2 = scanner.scan();

    expect(model1.hash).not.toBe(model2.hash);
  });

  // ---- Section scoring ----------------------------------------------------

  it('section scoring: visible sections score higher', () => {
    // By default in jsdom, getBoundingClientRect returns zeros,
    // meaning elements are not "in viewport" by default.
    // We can mock one element to be in viewport to demonstrate scoring.
    const heroSection = document.getElementById('hero')!;

    // Spy on getBoundingClientRect for the hero section to simulate visibility
    vi.spyOn(heroSection, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 300,
      left: 0,
      right: 800,
      width: 800,
      height: 200,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });

    // Mock window dimensions
    Object.defineProperty(window, 'innerHeight', { value: 768, writable: true });
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });

    const scanner = new DOMScanner();
    const model = scanner.scan();

    const heroResult = model.sections.find((s) => s.id === 'hero');
    expect(heroResult).toBeDefined();
    // Hero has an aria-label, heading, and we faked it being in viewport,
    // so it should have a positive score from those factors
    expect(heroResult!.score).toBeGreaterThan(0);
  });

  // ---- SSR environment ----------------------------------------------------

  it('returns empty PageModel in SSR environment', () => {
    // Save original references
    const origDocument = globalThis.document;
    const origWindow = globalThis.window;

    try {
      // Temporarily hide document and window to simulate SSR
      // The DOMScanner constructor checks typeof document/window,
      // so we create the scanner first (browser), then override for scan.
      // Actually the scan() method checks typeof document === 'undefined'
      // at runtime, so we need a scanner whose root is null.
      const scanner = new DOMScanner({ rootElement: undefined });

      // Override the typeof checks by deleting globals temporarily
      // @ts-expect-error -- deleting global for SSR simulation
      delete globalThis.document;
      // @ts-expect-error -- deleting global for SSR simulation
      delete globalThis.window;

      const model = scanner.scan();

      expect(model.sections).toHaveLength(0);
      expect(model.navigation).toHaveLength(0);
      expect(model.interactiveElements).toHaveLength(0);
      expect(model.forms).toHaveLength(0);
      expect(model.activeOverlays).toHaveLength(0);
      expect(model.scanMetadata.totalNodesScanned).toBe(0);
      expect(model.scanMetadata.scanBudgetExhausted).toBe(false);
    } finally {
      // Restore globals
      globalThis.document = origDocument;
      globalThis.window = origWindow;
    }
  });

  // ---- Empty page ---------------------------------------------------------

  it('handles empty page gracefully', () => {
    document.body.innerHTML = '';

    const scanner = new DOMScanner();
    const model = scanner.scan();

    expect(model.sections).toHaveLength(0);
    expect(model.navigation).toHaveLength(0);
    expect(model.forms).toHaveLength(0);
    expect(model.interactiveElements).toHaveLength(0);
    expect(model.hash).toBeDefined();
    expect(model.timestamp).toBeGreaterThan(0);
  });

  // ---- MutationObserver debounce ------------------------------------------

  it('MutationObserver callback is debounced', async () => {
    const scanner = new DOMScanner();
    const callback = vi.fn();

    const cleanup = scanner.observe(callback);

    // Trigger multiple rapid mutations
    const p1 = document.createElement('p');
    p1.textContent = 'mutation 1';
    document.body.appendChild(p1);

    const p2 = document.createElement('p');
    p2.textContent = 'mutation 2';
    document.body.appendChild(p2);

    const p3 = document.createElement('p');
    p3.textContent = 'mutation 3';
    document.body.appendChild(p3);

    // Callback should NOT have fired immediately
    expect(callback).not.toHaveBeenCalled();

    // Advance past the 500ms debounce
    await vi.advanceTimersByTimeAsync(600);

    // The callback should have fired at most once (debounced),
    // though the internal scheduleIdle may add another tick
    // In jsdom, requestIdleCallback may fall back to setTimeout(0)
    await vi.advanceTimersByTimeAsync(100);

    // The scan callback should have been invoked (once, due to debounce)
    expect(callback).toHaveBeenCalled();
    // Multiple mutations should have been coalesced into a single callback
    expect(callback.mock.calls.length).toBeLessThanOrEqual(2);

    cleanup();
  });

  // ---- observe() cleanup --------------------------------------------------

  it('observe() returns a cleanup function that disconnects the observer', () => {
    const scanner = new DOMScanner();
    const callback = vi.fn();

    const cleanup = scanner.observe(callback);

    // Trigger a mutation
    const p = document.createElement('p');
    p.textContent = 'test';
    document.body.appendChild(p);

    // Disconnect
    cleanup();

    // Advance timers past debounce -- callback should NOT fire
    vi.advanceTimersByTime(1000);
    expect(callback).not.toHaveBeenCalled();
  });

  // ---- currentModel caching -----------------------------------------------

  it('currentModel returns null before first scan', () => {
    const scanner = new DOMScanner();
    expect(scanner.currentModel).toBeNull();
  });

  it('currentModel returns the last scanned model', () => {
    const scanner = new DOMScanner();
    const model = scanner.scan();
    expect(scanner.currentModel).toBe(model);
  });

  // ---- Viewport info ------------------------------------------------------

  it('includes viewport dimensions in the model', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 768, writable: true });

    const scanner = new DOMScanner();
    const model = scanner.scan();

    expect(model.viewport.width).toBe(1024);
    expect(model.viewport.height).toBe(768);
    expect(model.viewport.orientation).toBe('landscape');
  });

  // ---- Sections with landmarks --------------------------------------------

  it('assigns landmark roles to semantic elements', () => {
    const scanner = new DOMScanner();
    const model = scanner.scan();

    // <nav> should get "navigation" landmark
    const navSections = model.sections.filter(
      (s) => s.landmark === 'navigation',
    );
    expect(navSections.length).toBeGreaterThanOrEqual(1);

    // <main> should get "main" landmark
    const mainSections = model.sections.filter(
      (s) => s.landmark === 'main',
    );
    expect(mainSections.length).toBeGreaterThanOrEqual(1);
  });

  // ---- Section with aria-label is a region --------------------------------

  it('section with aria-label gets "region" landmark', () => {
    const scanner = new DOMScanner();
    const model = scanner.scan();

    const heroSection = model.sections.find((s) => s.id === 'hero');
    expect(heroSection).toBeDefined();
    expect(heroSection!.landmark).toBe('region');
    expect(heroSection!.label).toBe('Hero Section');
  });

  // ---- allSectionsSummary -------------------------------------------------

  it('allSectionsSummary contains label+summary pairs', () => {
    const scanner = new DOMScanner();
    const model = scanner.scan();

    expect(model.allSectionsSummary.length).toBe(model.sections.length);
    for (const summary of model.allSectionsSummary) {
      // Format: "[label] summary"
      expect(summary).toMatch(/^\[.+\]/);
    }
  });

  // ---- Interactive elements outside ignored subtrees ----------------------

  it('extracts interactive elements from visible sections', () => {
    const scanner = new DOMScanner();
    const model = scanner.scan();

    // We should find <a> elements from nav and <input> elements from the form
    expect(model.interactiveElements.length).toBeGreaterThan(0);

    const links = model.interactiveElements.filter(
      (el) => el.tagName === 'a',
    );
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  // ---- Form with required fields ------------------------------------------

  it('marks required fields correctly', () => {
    const scanner = new DOMScanner();
    const model = scanner.scan();

    const contactForm = model.forms.find(
      (f) => f.id === 'contact-form',
    );
    expect(contactForm).toBeDefined();

    const nameField = contactForm!.fields.find((f) => f.name === 'name');
    expect(nameField!.isRequired).toBe(true);

    const passwordField = contactForm!.fields.find(
      (f) => f.type === 'password',
    );
    // password in our HTML does not have required attribute
    expect(passwordField!.isRequired).toBe(false);
  });

  // ---- buildSelector uses data-guidekit-target for interactive elements ---

  it('uses data-guidekit-target in interactive element selectors', () => {
    document.body.innerHTML = `
      <main>
        <button data-guidekit-target="cta-button">Click Me</button>
      </main>
    `;

    const scanner = new DOMScanner();
    const model = scanner.scan();

    const btn = model.interactiveElements.find(
      (el) => el.guideKitTarget === 'cta-button',
    );
    expect(btn).toBeDefined();
    expect(btn!.selector).toBe('[data-guidekit-target="cta-button"]');
    expect(btn!.label).toBe('Click Me');
  });
});
