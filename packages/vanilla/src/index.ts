// ---------------------------------------------------------------------------
// @guidekit/vanilla — Non-React IIFE bundle for script-tag integration
// ---------------------------------------------------------------------------
//
// Provides an imperative API for using GuideKit without React. Users include
// the script via a <script> tag and interact with the global `GuideKit` object.
//
// Usage:
//   <script src="https://cdn.jsdelivr.net/npm/@guidekit/vanilla/dist/index.global.js"></script>
//   <script>
//     GuideKit.init({
//       llm: { provider: 'gemini', apiKey: '...' },
//       agent: { name: 'Guide', greeting: 'Hello!' },
//     });
//   </script>
// ---------------------------------------------------------------------------

import { GuideKitCore } from '@guidekit/core';
import type {
  GuideKitCoreOptions,
  AgentState,
  GuideKitEvent,
  GuideKitErrorType,
  PageModel,
  HealthCheckResult,
  I18nStrings,
} from '@guidekit/core';

// ---------------------------------------------------------------------------
// Widget DOM (lightweight, no React — plain DOM manipulation)
// ---------------------------------------------------------------------------

const WIDGET_CSS = /* css */ `
  :host {
    --gk-primary: #6366f1;
    --gk-primary-hover: #4f46e5;
    --gk-bg: #ffffff;
    --gk-bg-secondary: #f8fafc;
    --gk-text: #1e293b;
    --gk-text-secondary: #64748b;
    --gk-border: #e2e8f0;
    --gk-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
    --gk-radius: 16px;
    --gk-fab-size: 56px;
    --gk-panel-width: 380px;
    --gk-panel-height: 520px;
    --gk-font: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    all: initial;
    font-family: var(--gk-font);
    position: fixed;
    z-index: 2147483647;
    bottom: 24px;
    right: 24px;
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
  .gk-fab {
    width: var(--gk-fab-size);
    height: var(--gk-fab-size);
    border-radius: 50%;
    border: none;
    background: var(--gk-primary);
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 16px rgba(99, 102, 241, 0.35);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    outline: none;
  }
  .gk-fab:hover {
    background: var(--gk-primary-hover);
    transform: scale(1.05);
  }
  .gk-fab:focus-visible {
    outline: 2px solid var(--gk-primary);
    outline-offset: 3px;
  }
  .gk-fab svg { width: 24px; height: 24px; fill: currentColor; }
  .gk-panel {
    position: absolute;
    bottom: calc(var(--gk-fab-size) + 16px);
    right: 0;
    width: var(--gk-panel-width);
    height: var(--gk-panel-height);
    background: var(--gk-bg);
    border-radius: var(--gk-radius);
    box-shadow: var(--gk-shadow);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    opacity: 0;
    transform: translateY(12px) scale(0.95);
    pointer-events: none;
    transition: opacity 0.2s ease, transform 0.2s ease;
  }
  .gk-panel.gk-open {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }
  .gk-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--gk-border);
    flex-shrink: 0;
  }
  .gk-header-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--gk-text);
    margin: 0;
  }
  .gk-close-btn {
    width: 28px; height: 28px; border-radius: 8px;
    border: none; background: transparent; color: var(--gk-text-secondary);
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    outline: none;
  }
  .gk-close-btn:hover { background: var(--gk-bg-secondary); color: var(--gk-text); }
  .gk-close-btn:focus-visible { outline: 2px solid var(--gk-primary); outline-offset: -2px; }
  .gk-close-btn svg { width: 16px; height: 16px; fill: currentColor; }
  .gk-transcript {
    flex: 1; overflow-y: auto; padding: 16px 20px;
    display: flex; flex-direction: column; gap: 12px; scroll-behavior: smooth;
  }
  .gk-empty {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    justify-content: center; color: var(--gk-text-secondary); text-align: center;
    padding: 32px 16px; font-size: 13px;
  }
  .gk-msg {
    max-width: 85%; padding: 10px 14px; border-radius: 12px;
    font-size: 14px; line-height: 1.5; word-wrap: break-word; white-space: pre-wrap;
  }
  .gk-msg-user {
    align-self: flex-end; background: var(--gk-primary);
    color: #fff; border-bottom-right-radius: 4px;
  }
  .gk-msg-assistant {
    align-self: flex-start; background: var(--gk-bg-secondary);
    color: var(--gk-text); border-bottom-left-radius: 4px;
  }
  .gk-dots {
    align-self: flex-start; display: flex; gap: 4px; padding: 12px 16px;
  }
  .gk-dot {
    width: 6px; height: 6px; border-radius: 50%; background: var(--gk-text-secondary);
    animation: gk-bounce 1.4s ease-in-out infinite;
  }
  .gk-dot:nth-child(2) { animation-delay: 0.16s; }
  .gk-dot:nth-child(3) { animation-delay: 0.32s; }
  @keyframes gk-bounce {
    0%, 80%, 100% { transform: translateY(0); }
    40% { transform: translateY(-6px); }
  }
  .gk-input-area {
    display: flex; align-items: flex-end; gap: 8px;
    padding: 12px 16px; border-top: 1px solid var(--gk-border); flex-shrink: 0;
  }
  .gk-input {
    flex: 1; min-height: 40px; max-height: 120px; padding: 8px 14px;
    border: 1px solid var(--gk-border); border-radius: 12px;
    background: var(--gk-bg); color: var(--gk-text);
    font-family: var(--gk-font); font-size: 14px; line-height: 1.5;
    resize: none; outline: none;
  }
  .gk-input:focus { border-color: var(--gk-primary); box-shadow: 0 0 0 3px rgba(99,102,241,0.15); }
  .gk-send-btn {
    width: 40px; height: 40px; border-radius: 12px; border: none;
    background: var(--gk-primary); color: #fff; cursor: pointer;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    outline: none;
  }
  .gk-send-btn:hover:not(:disabled) { background: var(--gk-primary-hover); }
  .gk-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .gk-send-btn:focus-visible { outline: 2px solid var(--gk-primary); outline-offset: 3px; }
  .gk-send-btn svg { width: 18px; height: 18px; fill: currentColor; }
  @media (hover: none) and (pointer: coarse), (max-width: 768px) {
    :host { bottom: 16px !important; right: 16px !important; }
    .gk-panel {
      position: fixed; bottom: 0; left: 0; right: 0;
      width: 100%; height: 70vh; max-height: 70vh;
      border-radius: var(--gk-radius) var(--gk-radius) 0 0;
      transform: translateY(100%);
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
    .gk-panel.gk-open { transform: translateY(0); }
    .gk-send-btn, .gk-close-btn { min-width: 44px; min-height: 44px; }
    .gk-input-area { padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)); }
  }
  @media (forced-colors: active) {
    .gk-fab, .gk-send-btn { border: 2px solid ButtonText; }
    .gk-panel { border: 1px solid ButtonText; }
  }
`;

const SVG_CHAT = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/><path d="M7 9h10v2H7zm0-3h10v2H7z"/></svg>';
const SVG_CLOSE = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
const SVG_SEND = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';

// ---------------------------------------------------------------------------
// VanillaWidget — renders and manages the chat widget without React
// ---------------------------------------------------------------------------

class VanillaWidget {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private panel!: HTMLDivElement;
  private transcript!: HTMLDivElement;
  private emptyState!: HTMLDivElement;
  private dotsEl!: HTMLDivElement;
  private input!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private fab!: HTMLButtonElement;
  private isOpen = false;
  private isSending = false;
  private core: GuideKitCore;

  constructor(core: GuideKitCore) {
    this.core = core;

    // Create Shadow DOM host
    this.host = document.createElement('div');
    this.host.id = 'guidekit-widget';
    this.host.style.cssText =
      'position:fixed;z-index:2147483647;bottom:24px;right:24px;margin:0;padding:0;border:none;background:none;';
    document.body.appendChild(this.host);

    this.shadow = this.host.attachShadow({ mode: 'open' });

    // Inject styles
    const style = document.createElement('style');
    style.textContent = WIDGET_CSS;
    this.shadow.appendChild(style);

    this.buildDOM();
    this.bindEvents();
  }

  private buildDOM(): void {
    // Panel
    this.panel = document.createElement('div');
    this.panel.className = 'gk-panel';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'GuideKit Assistant');
    this.panel.setAttribute('aria-hidden', 'true');

    // Header
    const header = document.createElement('div');
    header.className = 'gk-header';

    const title = document.createElement('div');
    title.className = 'gk-header-title';
    title.textContent = this.t('widgetTitle');
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'gk-close-btn';
    closeBtn.setAttribute('aria-label', this.t('closePanel'));
    closeBtn.innerHTML = SVG_CLOSE;
    closeBtn.addEventListener('click', () => this.togglePanel(false));
    header.appendChild(closeBtn);

    this.panel.appendChild(header);

    // Transcript
    this.transcript = document.createElement('div');
    this.transcript.className = 'gk-transcript';
    this.transcript.setAttribute('role', 'log');
    this.transcript.setAttribute('aria-live', 'polite');

    this.emptyState = document.createElement('div');
    this.emptyState.className = 'gk-empty';
    this.emptyState.textContent = this.t('emptyStateMessage');
    this.transcript.appendChild(this.emptyState);

    // Dots indicator (hidden by default)
    this.dotsEl = document.createElement('div');
    this.dotsEl.className = 'gk-dots';
    this.dotsEl.setAttribute('role', 'status');
    this.dotsEl.setAttribute('aria-label', 'Processing');
    this.dotsEl.style.display = 'none';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div');
      dot.className = 'gk-dot';
      this.dotsEl.appendChild(dot);
    }
    this.transcript.appendChild(this.dotsEl);

    this.panel.appendChild(this.transcript);

    // Input area
    const inputArea = document.createElement('div');
    inputArea.className = 'gk-input-area';

    this.input = document.createElement('textarea');
    this.input.className = 'gk-input';
    this.input.placeholder = this.t('inputPlaceholder');
    this.input.setAttribute('aria-label', this.t('sendMessage'));
    this.input.rows = 1;
    inputArea.appendChild(this.input);

    this.sendBtn = document.createElement('button');
    this.sendBtn.className = 'gk-send-btn';
    this.sendBtn.setAttribute('aria-label', this.t('sendMessage'));
    this.sendBtn.innerHTML = SVG_SEND;
    inputArea.appendChild(this.sendBtn);

    this.panel.appendChild(inputArea);
    this.shadow.appendChild(this.panel);

    // FAB
    this.fab = document.createElement('button');
    this.fab.className = 'gk-fab';
    this.fab.setAttribute('aria-label', this.t('openAssistant'));
    this.fab.setAttribute('aria-expanded', 'false');
    this.fab.setAttribute('aria-haspopup', 'dialog');
    this.fab.innerHTML = SVG_CHAT;
    this.shadow.appendChild(this.fab);
  }

  private bindEvents(): void {
    this.fab.addEventListener('click', () => this.togglePanel(!this.isOpen));

    this.sendBtn.addEventListener('click', () => this.handleSend());

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
      if (e.key === 'Escape') {
        this.togglePanel(false);
        this.fab.focus();
      }
    });
  }

  private togglePanel(open: boolean): void {
    this.isOpen = open;
    if (open) {
      this.panel.classList.add('gk-open');
      this.panel.setAttribute('aria-hidden', 'false');
      this.fab.setAttribute('aria-expanded', 'true');
      this.fab.innerHTML = SVG_CLOSE;
      this.fab.setAttribute('aria-label', this.t('closeAssistant'));
      setTimeout(() => this.input.focus(), 100);
    } else {
      this.panel.classList.remove('gk-open');
      this.panel.setAttribute('aria-hidden', 'true');
      this.fab.setAttribute('aria-expanded', 'false');
      this.fab.innerHTML = SVG_CHAT;
      this.fab.setAttribute('aria-label', this.t('openAssistant'));
    }
  }

  private async handleSend(): Promise<void> {
    const text = this.input.value.trim();
    if (!text || this.isSending) return;

    this.isSending = true;

    // Hide empty state
    this.emptyState.style.display = 'none';

    // Add user message
    this.addMessage('user', text);
    this.input.value = '';

    // Show processing dots
    this.dotsEl.style.display = 'flex';
    this.scrollToBottom();

    try {
      const response = await this.core.sendText(text);
      this.dotsEl.style.display = 'none';
      this.addMessage('assistant', response);
    } catch (err) {
      this.dotsEl.style.display = 'none';
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      this.addMessage('assistant', `Error: ${msg}`);
    } finally {
      this.isSending = false;
    }
  }

  private addMessage(role: 'user' | 'assistant', content: string): void {
    const el = document.createElement('div');
    el.className = `gk-msg gk-msg-${role}`;
    el.textContent = content;
    // Insert before the dots element
    this.transcript.insertBefore(el, this.dotsEl);
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    this.transcript.scrollTop = this.transcript.scrollHeight;
  }

  private t(key: string): string {
    try {
      return this.core.i18n.t(key as keyof I18nStrings) ?? key;
    } catch {
      return key;
    }
  }

  destroy(): void {
    this.host.remove();
  }
}

// ---------------------------------------------------------------------------
// GuideKitVanilla — imperative wrapper around GuideKitCore
// ---------------------------------------------------------------------------

export interface GuideKitVanillaOptions {
  tokenEndpoint?: string;
  stt?: GuideKitCoreOptions['stt'];
  tts?: GuideKitCoreOptions['tts'];
  llm?: GuideKitCoreOptions['llm'];
  agent?: GuideKitCoreOptions['agent'];
  contentMap?: GuideKitCoreOptions['contentMap'];
  options?: GuideKitCoreOptions['options'];
  instanceId?: string;
  rootElement?: HTMLElement;
  /** Disable the built-in widget UI (for headless use). */
  headless?: boolean;
  onError?: (error: GuideKitErrorType) => void;
  onEvent?: (event: GuideKitEvent) => void;
  onReady?: () => void;
}

/** Singleton state */
let _core: GuideKitCore | null = null;
let _widget: VanillaWidget | null = null;
let _initialized = false;

/**
 * Initialize GuideKit. Must be called before any other methods.
 * Idempotent — calling multiple times is safe (returns existing instance).
 */
export async function init(options: GuideKitVanillaOptions): Promise<void> {
  if (_initialized && _core) return;

  _core = new GuideKitCore({
    tokenEndpoint: options.tokenEndpoint,
    stt: options.stt,
    tts: options.tts,
    llm: options.llm,
    agent: options.agent,
    contentMap: options.contentMap,
    options: options.options,
    instanceId: options.instanceId,
    rootElement: options.rootElement,
    onError: options.onError,
    onEvent: options.onEvent,
    onReady: options.onReady,
  });

  await _core.init();

  // Create widget unless headless
  if (!options.headless) {
    _widget = new VanillaWidget(_core);
  }

  _initialized = true;
}

/**
 * Send a text message to the assistant. Returns the response.
 */
export async function sendText(message: string): Promise<string> {
  assertInitialized();
  return _core!.sendText(message);
}

/**
 * Highlight an element on the page.
 */
export function highlight(params: {
  sectionId?: string;
  selector?: string;
  tooltip?: string;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
}): boolean {
  assertInitialized();
  return _core!.highlight(params);
}

/** Dismiss the current spotlight highlight. */
export function dismissHighlight(): void {
  assertInitialized();
  _core!.dismissHighlight();
}

/** Smooth scroll to a section by ID. */
export function scrollToSection(sectionId: string, offset?: number): void {
  assertInitialized();
  _core!.scrollToSection(sectionId, offset);
}

/** Start a guided tour. */
export function startTour(sectionIds: string[], mode?: 'auto' | 'manual'): void {
  assertInitialized();
  _core!.startTour(sectionIds, mode);
}

/** Stop the current tour. */
export function stopTour(): void {
  assertInitialized();
  _core!.stopTour();
}

/** Navigate to a URL (same-origin only). */
export async function navigate(href: string): Promise<boolean> {
  assertInitialized();
  return _core!.navigate(href);
}

/** Set developer page context for the LLM. */
export function setPageContext(context: Record<string, unknown>): void {
  assertInitialized();
  _core!.setPageContext(context);
}

/** Register a custom action the LLM can invoke. */
export function registerAction(
  actionId: string,
  action: {
    description: string;
    parameters: Record<string, unknown>;
    handler: (params: Record<string, unknown>) => Promise<unknown>;
  },
): void {
  assertInitialized();
  _core!.registerAction(actionId, action);
}

/** Start voice input. */
export async function startListening(): Promise<void> {
  assertInitialized();
  await _core!.startListening();
}

/** Stop voice input. */
export function stopListening(): void {
  assertInitialized();
  _core!.stopListening();
}

/** Get current agent state. */
export function getAgentState(): AgentState {
  assertInitialized();
  return _core!.agentState;
}

/** Get current page model. */
export function getPageModel(): PageModel | null {
  assertInitialized();
  return _core!.pageModel;
}

/** Whether the SDK is ready. */
export function isReady(): boolean {
  return _core?.isReady ?? false;
}

/** Get/set quiet mode. */
export function getQuietMode(): boolean {
  assertInitialized();
  return _core!.quietMode;
}

export function setQuietMode(value: boolean): void {
  assertInitialized();
  _core!.quietMode = value;
}

/** Check health of all connected services. */
export async function checkHealth(): Promise<HealthCheckResult> {
  assertInitialized();
  return _core!.checkHealth();
}

/** Destroy the instance and clean up. */
export async function destroy(): Promise<void> {
  if (_widget) {
    _widget.destroy();
    _widget = null;
  }
  if (_core) {
    await _core.destroy();
    _core = null;
  }
  _initialized = false;
}

/** Get the underlying GuideKitCore instance (escape hatch). */
export function getCore(): GuideKitCore | null {
  return _core;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function assertInitialized(): void {
  if (!_core || !_initialized) {
    throw new Error(
      'GuideKit not initialized. Call GuideKit.init({...}) first.',
    );
  }
}

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

export const VERSION = '0.1.0';
