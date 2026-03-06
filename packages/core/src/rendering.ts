// ---------------------------------------------------------------------------
// @guidekit/core/rendering — Subpath export for markdown & theme utilities
// ---------------------------------------------------------------------------
// Separated from the main entry to keep `marked` out of bundles that don't
// need it (e.g. the vanilla IIFE).
// ---------------------------------------------------------------------------

export { MarkdownRenderer, defaultMarkdownRenderer, MARKDOWN_CSS } from './rendering/markdown-renderer.js';
export { ThemeEngine, LIGHT_TOKENS, DARK_TOKENS } from './rendering/theme-engine.js';
