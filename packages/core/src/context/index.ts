/**
 * @module @guidekit/core/context
 *
 * Context manager for the GuideKit SDK.
 * Assembles the LLM system prompt from the current page model, manages
 * conversation history with automatic eviction, resolves content-map entries,
 * and persists session state across page navigations via sessionStorage.
 */

import type {
  PageModel,
  ConversationTurn,
  ContentMapInput,
  ContentMap,
  ContentMapEntry,
  AgentConfig,
  ToolDefinition,
  SessionState,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_STORAGE_KEY = 'guidekit:session';
const DEFAULT_MAX_TURNS = 20;
const DEFAULT_MAX_SESSION_SIZE_BYTES = 50_000; // 50 KB
const DEFAULT_TOKEN_BUDGET = 6_000; // ~1 500 tokens
const CONTENT_MAP_TIMEOUT_MS = 2_000;
const CONTENT_CACHE_TTL_MS = 30_000; // 30 seconds

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Measure byte-length of a string in UTF-8. */
function byteLength(str: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).byteLength;
  }
  // Fallback for environments without TextEncoder (unlikely in modern runtimes)
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdfff) {
      bytes += 4;
      i++; // surrogate pair
    } else bytes += 3;
  }
  return bytes;
}

/** Race a promise against a timeout, returning `null` on timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, ms);

    promise
      .then((value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      });
  });
}

/** Check whether sessionStorage is available (SSR-safe). */
function hasSessionStorage(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.sessionStorage !== 'undefined'
    );
  } catch {
    // In some environments, accessing sessionStorage itself can throw (e.g. sandboxed iframes).
    return false;
  }
}

/** Truncate a string to a maximum character count, appending an ellipsis if trimmed. */
function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '\u2026';
}

// ---------------------------------------------------------------------------
// Content cache entry
// ---------------------------------------------------------------------------

interface CachedContent {
  entry: ContentMapEntry | null;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// ContextManager
// ---------------------------------------------------------------------------

export interface ContextManagerOptions {
  agent?: AgentConfig;
  contentMap?: ContentMapInput;
  maxTurns?: number;
  maxSessionSizeBytes?: number;
  tokenBudget?: number;
  debug?: boolean;
}

export class ContextManager {
  private agent: AgentConfig;
  private contentMap: ContentMapInput | undefined;
  private maxTurns: number;
  private maxSessionSizeBytes: number;
  private tokenBudget: number;
  private debug: boolean;

  private history: ConversationTurn[] = [];
  private contentCache: Map<string, CachedContent> = new Map();

  // Session preferences (persisted across navigations)
  private _userPreference: 'voice' | 'text' = 'text';
  private _quietMode = false;
  private _pageContext: Record<string, unknown> = {};

  constructor(options?: ContextManagerOptions) {
    this.agent = options?.agent ?? {};
    this.contentMap = options?.contentMap;
    this.maxTurns = options?.maxTurns ?? DEFAULT_MAX_TURNS;
    this.maxSessionSizeBytes =
      options?.maxSessionSizeBytes ?? DEFAULT_MAX_SESSION_SIZE_BYTES;
    this.tokenBudget = options?.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
    this.debug = options?.debug ?? false;
  }

  // -------------------------------------------------------------------------
  // System prompt
  // -------------------------------------------------------------------------

  /**
   * Build the full system prompt from the current page model and available
   * tools. The output is capped at `tokenBudget` characters so it fits
   * comfortably inside the LLM context window alongside conversation history.
   */
  buildSystemPrompt(pageModel: PageModel, tools: ToolDefinition[]): string {
    const parts: string[] = [];

    // -- Role ----------------------------------------------------------------
    parts.push(this.buildRoleSection());

    // -- Current Page --------------------------------------------------------
    parts.push(this.buildCurrentPageSection(pageModel));

    // -- Page Sections -------------------------------------------------------
    parts.push(this.buildPageSectionsSection(pageModel));

    // -- Navigation ----------------------------------------------------------
    if (pageModel.navigation.length > 0) {
      parts.push(this.buildNavigationSection(pageModel));
    }

    // -- Interactive Elements ------------------------------------------------
    if (pageModel.interactiveElements.length > 0) {
      parts.push(this.buildInteractiveElementsSection(pageModel));
    }

    // -- Forms ---------------------------------------------------------------
    if (pageModel.forms.length > 0) {
      parts.push(this.buildFormsSection(pageModel));
    }

    // -- User Viewport -------------------------------------------------------
    parts.push(this.buildViewportSection(pageModel));

    // -- Available Actions ---------------------------------------------------
    if (tools.length > 0) {
      parts.push(this.buildToolsSection(tools));
    }

    // -- Developer Context ---------------------------------------------------
    const pageCtxKeys = Object.keys(this._pageContext);
    if (pageCtxKeys.length > 0) {
      parts.push(this.buildPageContextSection());
    }

    // -- Guidelines ----------------------------------------------------------
    parts.push(this.buildGuidelinesSection());

    // Join and enforce budget
    let prompt = parts.join('\n\n');
    if (prompt.length > this.tokenBudget) {
      prompt = this.trimPromptToBudget(prompt, pageModel, tools);
    }

    return prompt;
  }

  // -------------------------------------------------------------------------
  // Conversation history
  // -------------------------------------------------------------------------

  /** Append a turn to the conversation history, enforcing size constraints. */
  addTurn(turn: ConversationTurn): void {
    this.history.push(turn);
    this.enforceHistoryLimits();
  }

  /** Return a copy of the current conversation history. */
  getHistory(): ConversationTurn[] {
    return this.history.slice();
  }

  /** Clear all conversation history. */
  clearHistory(): void {
    this.history = [];
  }

  // -------------------------------------------------------------------------
  // Content map
  // -------------------------------------------------------------------------

  /**
   * Resolve a `ContentMapEntry` for the given `sectionId`.
   *
   * - Static maps are looked up directly.
   * - Function-based maps are called with a 2-second timeout.
   * - Results are cached for 30 seconds per section ID.
   */
  async getContent(sectionId: string): Promise<ContentMapEntry | null> {
    // Check cache first
    const cached = this.contentCache.get(sectionId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.entry;
    }

    if (this.contentMap === undefined) {
      return null;
    }

    let entry: ContentMapEntry | null;

    if (typeof this.contentMap === 'function') {
      try {
        const result = this.contentMap(sectionId);
        if (result instanceof Promise) {
          entry = await withTimeout(result, CONTENT_MAP_TIMEOUT_MS);
        } else {
          entry = result;
        }
      } catch (err) {
        this.log('Content map function threw for sectionId:', sectionId, err);
        entry = null;
      }
    } else {
      // Static Record<string, ContentMapEntry>
      entry = (this.contentMap as ContentMap)[sectionId] ?? null;
    }

    // Cache the result
    this.contentCache.set(sectionId, {
      entry,
      expiresAt: Date.now() + CONTENT_CACHE_TTL_MS,
    });

    return entry;
  }

  /** Replace the content map used for section lookups. Clears the cache. */
  setContentMap(contentMap: ContentMapInput): void {
    this.contentMap = contentMap;
    this.contentCache.clear();
  }

  // -------------------------------------------------------------------------
  // Session preferences
  // -------------------------------------------------------------------------

  get userPreference(): 'voice' | 'text' {
    return this._userPreference;
  }

  set userPreference(value: 'voice' | 'text') {
    this._userPreference = value;
  }

  get quietMode(): boolean {
    return this._quietMode;
  }

  set quietMode(value: boolean) {
    this._quietMode = value;
  }

  // -------------------------------------------------------------------------
  // Page context (dynamic context injection)
  // -------------------------------------------------------------------------

  /** Set developer-supplied page context (merged into system prompt). */
  setPageContext(context: Record<string, unknown>): void {
    this._pageContext = { ...this._pageContext, ...context };
    this.log('Page context updated', Object.keys(context));
  }

  /** Get the current page context. */
  getPageContext(): Record<string, unknown> {
    return { ...this._pageContext };
  }

  /** Clear all page context. */
  clearPageContext(): void {
    this._pageContext = {};
  }

  // -------------------------------------------------------------------------
  // Session persistence
  // -------------------------------------------------------------------------

  /** Persist the current session state to `sessionStorage`. */
  saveSession(): void {
    if (!hasSessionStorage()) return;

    const state = this.getSessionState();
    try {
      window.sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify(state),
      );
    } catch (err) {
      this.log('Failed to save session:', err);
    }
  }

  /** Restore a previously persisted session from `sessionStorage`. */
  restoreSession(): SessionState | null {
    if (!hasSessionStorage()) return null;

    try {
      const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;

      const state = JSON.parse(raw) as SessionState;

      // Validate minimal shape
      if (
        !Array.isArray(state.conversationHistory) ||
        typeof state.currentUrl !== 'string'
      ) {
        this.log('Invalid session state, discarding.');
        return null;
      }

      // Restore conversation history
      this.history = state.conversationHistory;
      this.enforceHistoryLimits();

      // Restore preferences
      if (state.userPreference === 'voice' || state.userPreference === 'text') {
        this._userPreference = state.userPreference;
      }
      if (typeof state.quietMode === 'boolean') {
        this._quietMode = state.quietMode;
      }

      return state;
    } catch (err) {
      this.log('Failed to restore session:', err);
      return null;
    }
  }

  /** Build the current session state snapshot. */
  getSessionState(): SessionState {
    const serialised = JSON.stringify(this.history);
    const currentUrl =
      typeof window !== 'undefined' ? window.location.href : '';

    return {
      conversationHistory: this.history,
      currentUrl,
      agentStatus: 'idle',
      userPreference: this._userPreference,
      quietMode: this._quietMode,
      totalSizeBytes: byteLength(serialised),
    };
  }

  // -------------------------------------------------------------------------
  // Private — prompt section builders
  // -------------------------------------------------------------------------

  private buildRoleSection(): string {
    const name = this.agent.name || 'GuideKit';
    const personality =
      this.agent.personality ||
      'You help users understand and navigate the site.';
    return `# Role\nYou are ${name}, an AI guide embedded on this website.\n${personality}`;
  }

  private buildCurrentPageSection(pageModel: PageModel): string {
    const lines = ['# Current Page'];
    lines.push(`URL: ${pageModel.url}`);
    lines.push(`Title: ${pageModel.title}`);
    if (pageModel.meta.description) {
      lines.push(`Description: ${pageModel.meta.description}`);
    }
    lines.push(`Language: ${pageModel.meta.language}`);
    return lines.join('\n');
  }

  private buildPageSectionsSection(pageModel: PageModel): string {
    const { sectionsIncluded, totalSectionsFound } = pageModel.scanMetadata;
    const lines = [
      `# Page Sections (${sectionsIncluded} of ${totalSectionsFound})`,
    ];

    for (const section of pageModel.sections) {
      const vis = section.isVisible ? 'visible' : 'hidden';
      lines.push(
        `- [${section.id}] ${section.label}: ${truncate(section.summary, 120)} (${vis})`,
      );
    }

    if (sectionsIncluded < totalSectionsFound) {
      lines.push(
        `\nNote: You see ${sectionsIncluded} of ${totalSectionsFound} sections. Use readPageContent to access more.`,
      );
    }

    return lines.join('\n');
  }

  private buildNavigationSection(pageModel: PageModel): string {
    const lines = ['# Navigation'];
    for (const nav of pageModel.navigation) {
      const current = nav.isCurrent ? ' (current)' : '';
      lines.push(`- ${nav.label}: ${nav.href}${current}`);
    }
    return lines.join('\n');
  }

  private buildInteractiveElementsSection(pageModel: PageModel): string {
    const lines = ['# Interactive Elements'];
    for (const el of pageModel.interactiveElements) {
      const disabled = el.isDisabled ? ' [disabled]' : '';
      lines.push(
        `- ${el.tagName}${el.type ? `[${el.type}]` : ''}: ${el.label}${disabled} (${el.selector})`,
      );
    }
    return lines.join('\n');
  }

  private buildFormsSection(pageModel: PageModel): string {
    const lines = ['# Forms'];
    for (const form of pageModel.forms) {
      const formId = form.id ? ` id="${form.id}"` : '';
      const errors = form.hasValidationErrors ? ' [has errors]' : '';
      lines.push(`- <form${formId}>${errors}`);
      for (const field of form.fields) {
        const req = field.isRequired ? ' *' : '';
        const err = field.hasError
          ? ` [error: ${field.errorMessage || 'invalid'}]`
          : '';
        lines.push(
          `  - ${field.label || field.name} (${field.type})${req}${err}`,
        );
      }
    }
    return lines.join('\n');
  }

  private buildViewportSection(pageModel: PageModel): string {
    const { width, height, orientation } = pageModel.viewport;
    return `# User Viewport\n${width}x${height}, ${orientation}`;
  }

  private buildToolsSection(tools: ToolDefinition[]): string {
    const lines = ['# Available Actions'];
    for (const tool of tools) {
      lines.push(`- ${tool.name}: ${tool.description}`);
    }
    return lines.join('\n');
  }

  private buildPageContextSection(): string {
    const lines = ['# Developer Context'];
    for (const [key, value] of Object.entries(this._pageContext)) {
      const valStr =
        typeof value === 'string'
          ? value
          : JSON.stringify(value);
      lines.push(`- ${key}: ${truncate(String(valStr), 200)}`);
    }
    return lines.join('\n');
  }

  private buildGuidelinesSection(): string {
    return [
      '# Guidelines',
      '- Always reference specific sections by their ID when guiding users',
      '- Use highlight() to point at elements you are discussing',
      '- Use scrollToSection() before highlighting offscreen elements',
      '- Never make up information not present in the page context',
      '- If asked about content you cannot see, use readPageContent to access it',
      '- Keep responses concise — 2-3 sentences unless the user asks for detail',
    ].join('\n');
  }

  // -------------------------------------------------------------------------
  // Private — prompt trimming
  // -------------------------------------------------------------------------

  /**
   * When the assembled prompt exceeds the budget, progressively trim
   * lower-priority sections to fit.
   */
  private trimPromptToBudget(
    _fullPrompt: string,
    pageModel: PageModel,
    tools: ToolDefinition[],
  ): string {
    // Rebuild with trimming strategies applied in priority order:
    // 1. Truncate interactive elements list
    // 2. Truncate navigation list
    // 3. Truncate forms
    // 4. Truncate page sections

    const essentialParts: string[] = [
      this.buildRoleSection(),
      this.buildCurrentPageSection(pageModel),
      this.buildViewportSection(pageModel),
      this.buildGuidelinesSection(),
    ];

    if (tools.length > 0) {
      essentialParts.push(this.buildToolsSection(tools));
    }

    const essentialLength = essentialParts.reduce(
      (sum, p) => sum + p.length + 2,
      0,
    );
    let remaining = this.tokenBudget - essentialLength;

    const optionalSections: string[] = [];

    // Page sections — highest priority optional section
    const sectionsStr = this.buildPageSectionsSection(pageModel);
    if (sectionsStr.length <= remaining) {
      optionalSections.push(sectionsStr);
      remaining -= sectionsStr.length + 2;
    } else if (remaining > 100) {
      optionalSections.push(truncate(sectionsStr, remaining));
      remaining = 0;
    }

    // Navigation
    if (remaining > 0 && pageModel.navigation.length > 0) {
      const navStr = this.buildNavigationSection(pageModel);
      if (navStr.length <= remaining) {
        optionalSections.push(navStr);
        remaining -= navStr.length + 2;
      } else if (remaining > 80) {
        optionalSections.push(truncate(navStr, remaining));
        remaining = 0;
      }
    }

    // Forms
    if (remaining > 0 && pageModel.forms.length > 0) {
      const formsStr = this.buildFormsSection(pageModel);
      if (formsStr.length <= remaining) {
        optionalSections.push(formsStr);
        remaining -= formsStr.length + 2;
      } else if (remaining > 80) {
        optionalSections.push(truncate(formsStr, remaining));
        remaining = 0;
      }
    }

    // Interactive elements
    if (remaining > 0 && pageModel.interactiveElements.length > 0) {
      const ieStr = this.buildInteractiveElementsSection(pageModel);
      if (ieStr.length <= remaining) {
        optionalSections.push(ieStr);
      } else if (remaining > 80) {
        optionalSections.push(truncate(ieStr, remaining));
      }
    }

    // Insert optional sections after current-page and before viewport
    const result = [
      essentialParts[0], // Role
      essentialParts[1], // Current Page
      ...optionalSections,
      essentialParts[2], // Viewport
      ...essentialParts.slice(3), // Tools + Guidelines
    ];

    return result.join('\n\n');
  }

  // -------------------------------------------------------------------------
  // Private — history management
  // -------------------------------------------------------------------------

  /**
   * Enforce `maxTurns` and `maxSessionSizeBytes` constraints on the
   * conversation history. When the history approaches 80% of `maxTurns`,
   * the oldest turns are summarised into a single recap turn.
   */
  private enforceHistoryLimits(): void {
    // -- Summarise when near capacity (>80% of maxTurns) --------------------
    const summariseThreshold = Math.floor(this.maxTurns * 0.8);
    if (this.history.length > summariseThreshold) {
      this.summariseOldestTurns();
    }

    // -- Hard cap on turn count ---------------------------------------------
    while (this.history.length > this.maxTurns) {
      this.history.shift();
    }

    // -- Enforce byte-size limit --------------------------------------------
    this.enforceByteLimit();
  }

  /**
   * Compress the oldest half of turns into a single recap turn so the
   * context window is used more efficiently.
   */
  private summariseOldestTurns(): void {
    if (this.history.length < 4) return; // Not enough to summarise

    const splitIndex = Math.floor(this.history.length / 2);
    const oldTurns = this.history.slice(0, splitIndex);
    const recentTurns = this.history.slice(splitIndex);

    // Build a compact recap from the old turns
    const recapLines: string[] = [];
    for (const turn of oldTurns) {
      const role = turn.role === 'user' ? 'User' : 'Assistant';
      recapLines.push(`${role}: ${truncate(turn.content, 150)}`);
    }

    const recapTurn: ConversationTurn = {
      role: 'assistant',
      content: `[Conversation recap]\n${recapLines.join('\n')}`,
      timestamp: oldTurns[oldTurns.length - 1]!.timestamp,
    };

    this.history = [recapTurn, ...recentTurns];
  }

  /** Evict oldest turns until the serialised history fits within the byte budget. */
  private enforceByteLimit(): void {
    while (this.history.length > 1) {
      const serialised = JSON.stringify(this.history);
      if (byteLength(serialised) <= this.maxSessionSizeBytes) break;
      this.history.shift();
    }
  }

  // -------------------------------------------------------------------------
  // Private — debug logging
  // -------------------------------------------------------------------------

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.debug('[GuideKit:ContextManager]', ...args);
    }
  }
}
