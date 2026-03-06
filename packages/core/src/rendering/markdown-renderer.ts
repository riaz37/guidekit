/**
 * @module @guidekit/core/rendering
 *
 * Markdown Rendering System for the GuideKit SDK.
 * Converts markdown strings to sanitised HTML using `marked`, with custom
 * renderer overrides for headings, links, code blocks, and inline code.
 *
 * Key design decisions:
 * - Uses `marked` for parsing (lightweight, zero-dependency).
 * - XSS prevention via DOM-tree walking in renderToDOM() — no DOMPurify needed.
 * - Custom renderer adds slug-based heading IDs, safe external links, and
 *   copy-button wrappers around fenced code blocks.
 * - CSS custom properties for easy theming integration.
 * - SSR-safe: browser APIs are guarded behind typeof checks.
 */

import { Marked, type Tokens, type RendererObject } from 'marked';

// ---------------------------------------------------------------------------
// Constants & Helpers
// ---------------------------------------------------------------------------

const DANGEROUS_ELEMENTS = new Set(['script', 'iframe', 'object', 'embed', 'form']);
const DANGEROUS_ATTR_RE = /^on/i;
const DANGEROUS_HREF_RE = /^\s*(javascript|data):/i;

/** Convert a heading string into a URL-safe slug for anchor linking. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Walk an element tree and strip dangerous nodes / attributes in-place. */
function sanitiseTree(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const toRemove: Element[] = [];

  let node = walker.nextNode() as Element | null;
  while (node) {
    if (DANGEROUS_ELEMENTS.has(node.tagName.toLowerCase())) {
      toRemove.push(node);
    } else {
      // Strip dangerous attributes
      const attrs = Array.from(node.attributes);
      for (const attr of attrs) {
        const name = attr.name.toLowerCase();
        if (DANGEROUS_ATTR_RE.test(name)) {
          node.removeAttribute(attr.name);
        } else if (
          (name === 'href' || name === 'src' || name === 'action') &&
          DANGEROUS_HREF_RE.test(attr.value)
        ) {
          node.removeAttribute(attr.name);
        }
      }
    }
    node = walker.nextNode() as Element | null;
  }

  for (const el of toRemove) {
    el.parentNode?.removeChild(el);
  }
}

// ---------------------------------------------------------------------------
// Custom marked renderer
// ---------------------------------------------------------------------------

function createRenderer(): RendererObject {
  return {
    heading({ tokens, depth }: Tokens.Heading): string {
      const text = this.parser.parseInline(tokens);
      const raw = tokens.map((t) => ('raw' in t ? (t as { raw: string }).raw : '')).join('');
      const id = slugify(raw);
      return `<h${depth} id="${id}">${text}</h${depth}>\n`;
    },

    link({ href, title, tokens }: Tokens.Link): string {
      const text = this.parser.parseInline(tokens);
      const titleAttr = title ? ` title="${title}"` : '';
      const isExternal = /^https?:\/\//.test(href);
      const externalAttrs = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${href}"${titleAttr}${externalAttrs}>${text}</a>`;
    },

    code({ text, lang }: Tokens.Code): string {
      const langClass = lang ? ` class="language-${lang}"` : '';
      const escaped = text.replace(/"/g, '&quot;');
      return (
        `<div class="gk-code-block">` +
        `<button class="gk-copy-btn" data-code="${escaped}">Copy</button>` +
        `<pre><code${langClass}>${text}</code></pre>` +
        `</div>\n`
      );
    },

    codespan({ text }: Tokens.Codespan): string {
      return `<code class="gk-inline-code">${text}</code>`;
    },
  };
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

/** Compact CSS for markdown-rendered content. Uses CSS custom properties for theming. */
export const MARKDOWN_CSS = [
  '.gk-markdown{color:var(--gk-text-color,inherit);line-height:1.6;word-wrap:break-word}',
  '.gk-markdown h1,.gk-markdown h2,.gk-markdown h3,.gk-markdown h4,.gk-markdown h5,.gk-markdown h6{margin:1em 0 .5em;font-weight:600;line-height:1.25}',
  '.gk-markdown h1{font-size:1.5em}.gk-markdown h2{font-size:1.3em}.gk-markdown h3{font-size:1.15em}',
  '.gk-markdown p{margin:0 0 .75em}',
  '.gk-markdown a{color:var(--gk-link-color,#2563eb);text-decoration:underline}.gk-markdown a:hover{opacity:.8}',
  '.gk-markdown ul,.gk-markdown ol{margin:0 0 .75em;padding-left:1.5em}.gk-markdown li{margin:.25em 0}',
  '.gk-markdown blockquote{margin:0 0 .75em;padding:.5em 1em;border-left:3px solid var(--gk-border-color,#e4e4e7);color:#71717a}',
  '.gk-markdown table{width:100%;border-collapse:collapse;margin:0 0 .75em}',
  '.gk-markdown th,.gk-markdown td{padding:.4em .75em;border:1px solid var(--gk-border-color,#e4e4e7);text-align:left}',
  '.gk-markdown th{background:var(--gk-bg-code,#f4f4f5);font-weight:600}',
  '.gk-markdown .gk-inline-code{background:var(--gk-bg-code,#f4f4f5);padding:.15em .35em;border-radius:3px;font-size:.9em}',
  '.gk-code-block{position:relative;margin:0 0 .75em;border:1px solid var(--gk-border-color,#e4e4e7);border-radius:6px;overflow:hidden}',
  '.gk-code-block pre{margin:0;padding:.75em 1em;background:var(--gk-bg-code,#f4f4f5);overflow-x:auto;font-size:.875em;line-height:1.5}',
  '.gk-code-block code{background:none;padding:0}',
  '.gk-copy-btn{position:absolute;top:.4em;right:.4em;padding:.2em .5em;font-size:.75em;cursor:pointer;background:#fff;border:1px solid var(--gk-border-color,#e4e4e7);border-radius:4px;opacity:.7;transition:opacity .15s}',
  '.gk-copy-btn:hover{opacity:1}',
].join('\n');

// ---------------------------------------------------------------------------
// MarkdownRenderer
// ---------------------------------------------------------------------------

export class MarkdownRenderer {
  private readonly markedInstance: Marked;

  constructor(options?: { sanitize?: boolean }) {
    // Create a new marked instance with our custom renderer
    this.markedInstance = new Marked();
    this.markedInstance.use({
      renderer: createRenderer(),
      async: false,
    });

    // The sanitize option is accepted for API completeness; actual
    // sanitisation happens in renderToDOM(). The render() path returns
    // raw HTML — callers should prefer renderToDOM() for safe output.
    void options?.sanitize;
  }

  /**
   * Convert a markdown string to an HTML string.
   * **Note:** The returned HTML is NOT sanitised — prefer `renderToDOM()` for safe output.
   */
  render(markdown: string): string {
    return this.markedInstance.parse(markdown) as string;
  }

  /** Render markdown into a DOM container with built-in XSS sanitisation. */
  renderToDOM(markdown: string, container: HTMLElement): void {
    if (typeof document === 'undefined') return;

    const html = this.render(markdown);

    // Parse into a temporary container
    const tmp = document.createElement('div');
    tmp.innerHTML = html;

    // Walk and sanitise the tree
    sanitiseTree(tmp);

    // Clear the target container and move clean nodes in
    container.innerHTML = '';
    while (tmp.firstChild) {
      container.appendChild(tmp.firstChild);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/** Pre-configured default renderer instance. */
export const defaultMarkdownRenderer = new MarkdownRenderer();
