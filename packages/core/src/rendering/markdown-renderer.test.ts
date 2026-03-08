// ---------------------------------------------------------------------------
// MarkdownRenderer – Unit Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest';
import { MarkdownRenderer, MARKDOWN_CSS } from './markdown-renderer.js';

describe('MarkdownRenderer', () => {
  let renderer: MarkdownRenderer;

  beforeEach(() => {
    renderer = new MarkdownRenderer();
  });

  // ── render() basic output ────────────────────────────────────────────

  describe('render()', () => {
    it('renders headings with slug IDs', () => {
      const html = renderer.render('# Hello World');
      expect(html).toContain('<h1 id="hello-world">Hello World</h1>');
    });

    it('renders h2 headings', () => {
      const html = renderer.render('## Second Level');
      expect(html).toContain('<h2 id="second-level">Second Level</h2>');
    });

    it('renders paragraphs', () => {
      const html = renderer.render('This is a paragraph.');
      expect(html).toContain('<p>This is a paragraph.</p>');
    });

    it('renders unordered lists', () => {
      const html = renderer.render('- item one\n- item two');
      expect(html).toContain('<ul>');
      expect(html).toContain('<li>item one</li>');
      expect(html).toContain('<li>item two</li>');
    });

    it('renders ordered lists', () => {
      const html = renderer.render('1. first\n2. second');
      expect(html).toContain('<ol>');
      expect(html).toContain('<li>first</li>');
      expect(html).toContain('<li>second</li>');
    });

    it('renders inline code with gk-inline-code class', () => {
      const html = renderer.render('Use `console.log`');
      expect(html).toContain('<code class="gk-inline-code">console.log</code>');
    });
  });

  // ── Code block rendering ─────────────────────────────────────────────

  describe('code blocks', () => {
    it('renders fenced code blocks with copy button', () => {
      const html = renderer.render('```\nconsole.log("hi")\n```');
      expect(html).toContain('<div class="gk-code-block">');
      expect(html).toContain('<button class="gk-copy-btn"');
      expect(html).toContain('<pre><code>');
    });

    it('renders code blocks with language class', () => {
      const html = renderer.render('```javascript\nconst x = 1;\n```');
      expect(html).toContain('class="language-javascript"');
    });

    it('escapes HTML in code blocks', () => {
      const html = renderer.render('```\n<script>alert(1)</script>\n```');
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>');
    });
  });

  // ── Link rendering ──────────────────────────────────────────────────

  describe('links', () => {
    it('renders external links with target="_blank" and rel attrs', () => {
      const html = renderer.render('[Example](https://example.com)');
      expect(html).toContain('href="https://example.com"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
    });

    it('renders internal links without external attrs', () => {
      const html = renderer.render('[Section](/docs/section)');
      expect(html).toContain('href="/docs/section"');
      expect(html).not.toContain('target="_blank"');
    });

    it('renders title attributes', () => {
      const html = renderer.render('[link](https://example.com "My Title")');
      expect(html).toContain('title="My Title"');
    });
  });

  // ── XSS prevention ─────────────────────────────────────────────────

  describe('XSS prevention', () => {
    it('strips javascript: hrefs from links', () => {
      const html = renderer.render('[click](javascript:alert(1))');
      expect(html).not.toContain('javascript:');
      // The link text should still be rendered
      expect(html).toContain('click');
    });

    it('strips data: hrefs from links', () => {
      const html = renderer.render('[click](data:text/html,<script>alert(1)</script>)');
      expect(html).not.toContain('data:');
      expect(html).toContain('click');
    });

    it('strips javascript: with leading whitespace', () => {
      const html = renderer.render('[click](  javascript:alert(1))');
      expect(html).not.toContain('javascript:');
    });

    it('escapes HTML in code blocks to prevent script injection', () => {
      const html = renderer.render('```\n<script>alert(1)</script>\n```');
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>alert');
    });

    it('escapes href attribute values to prevent attribute injection', () => {
      const html = renderer.render('[link](https://example.com/a"onmouseover="alert(1))');
      expect(html).toContain('&quot;');
    });

    it('escapes HTML in inline code', () => {
      const html = renderer.render('Use `<img src=x onerror=alert(1)>`');
      expect(html).toContain('&lt;img');
      expect(html).not.toContain('<img src=x onerror');
    });

    it('escapes language attribute in code blocks', () => {
      const html = renderer.render('```"><img src=x onerror=alert(1)>\ncode\n```');
      // Quotes are escaped, preventing attribute breakout
      expect(html).toContain('&quot;');
      // The angle brackets are escaped, preventing tag injection
      expect(html).toContain('&lt;');
      expect(html).toContain('&gt;');
    });
  });

  // ── renderToDOM() ───────────────────────────────────────────────────

  describe('renderToDOM()', () => {
    it('renders markdown into a DOM container', () => {
      const container = document.createElement('div');
      renderer.renderToDOM('# Hello', container);
      expect(container.querySelector('h1')).not.toBeNull();
      expect(container.querySelector('h1')?.textContent).toBe('Hello');
    });

    it('strips script tags via sanitiseTree', () => {
      const container = document.createElement('div');
      // Manually set innerHTML to include a script to test sanitisation
      renderer.renderToDOM('Hello <script>alert(1)</script> world', container);
      expect(container.querySelector('script')).toBeNull();
    });

    it('strips iframe elements', () => {
      const container = document.createElement('div');
      renderer.renderToDOM('Hello <iframe src="evil.com"></iframe> world', container);
      expect(container.querySelector('iframe')).toBeNull();
    });

    it('clears the container before rendering', () => {
      const container = document.createElement('div');
      container.innerHTML = '<p>old content</p>';
      renderer.renderToDOM('# New', container);
      expect(container.innerHTML).not.toContain('old content');
      expect(container.querySelector('h1')).not.toBeNull();
    });
  });

  // ── MARKDOWN_CSS export ─────────────────────────────────────────────

  describe('MARKDOWN_CSS', () => {
    it('exports a non-empty CSS string', () => {
      expect(MARKDOWN_CSS).toBeTruthy();
      expect(MARKDOWN_CSS).toContain('.gk-markdown');
      expect(MARKDOWN_CSS).toContain('.gk-code-block');
    });
  });

  // ── Constructor options ─────────────────────────────────────────────

  describe('constructor', () => {
    it('accepts sanitize option without error', () => {
      const r = new MarkdownRenderer({ sanitize: true });
      expect(r.render('# Test')).toContain('<h1');
    });
  });
});
