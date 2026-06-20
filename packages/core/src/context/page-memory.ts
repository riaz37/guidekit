/**
 * @module @guidekit/core/context/page-memory
 *
 * Incremental page context: PageMemory cache, TurnDelta, and working-set assembly.
 */

import type {
  InteractiveElement,
  OverlayElement,
  PageModel,
  PageSection,
} from '../types/index.js';

export interface PageMemory {
  pageKey: string;
  hash: string;
  summary: string;
  sectionLines: string[];
  navLines: string[];
  interactiveLines: string[];
  overlayLines: string[];
  builtAt: number;
}

export interface TurnDelta {
  hashChanged: boolean;
  previousHash: string | null;
  urlChanged: boolean;
  addedSectionIds: string[];
  removedSectionIds: string[];
  overlayChange: string | null;
  visibleShift: string | null;
}

export interface WorkingSet {
  visibleSections: PageSection[];
  topInteractives: InteractiveElement[];
  visibleOverlays: OverlayElement[];
}

export interface SiteMemoryIndex {
  pages: Map<string, PageMemory>;
  routeSummaries: string[];
}

const MAX_SECTION_LINES = 20;
const MAX_NAV_LINES = 12;
const MAX_INTERACTIVE_LINES = 15;
const MAX_OVERLAY_LINES = 5;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** Stable page key: origin + pathname (ignores hash/query for memory bucket). */
export function pageKeyFromModel(model: PageModel): string {
  if (typeof window === 'undefined') return model.url;
  try {
    const url = new URL(model.url);
    return `${url.origin}${url.pathname}`;
  } catch {
    return model.url.split('?')[0] ?? model.url;
  }
}

export function buildPageMemory(model: PageModel): PageMemory {
  const h1 = model.meta.h1 ? ` — ${model.meta.h1}` : '';
  const summary = `${model.title}${h1}`.trim();

  const sectionLines = model.sections.slice(0, MAX_SECTION_LINES).map(
    (s) => `- [${s.id}] ${s.label}: ${truncate(s.summary, 80)}`,
  );

  const navLines = model.navigation.slice(0, MAX_NAV_LINES).map(
    (n) => `- ${n.label}: ${n.href}${n.isCurrent ? ' (current)' : ''}`,
  );

  const interactiveLines = model.interactiveElements
    .slice(0, MAX_INTERACTIVE_LINES)
    .map(
      (el) =>
        `- ${el.tagName}${el.type ? `[${el.type}]` : ''}: ${truncate(el.label, 50)} (${el.selector})`,
    );

  const overlayLines = model.activeOverlays
    .filter((o) => o.isVisible)
    .slice(0, MAX_OVERLAY_LINES)
    .map((o) => `- ${o.type}: ${o.label} (${o.selector})`);

  return {
    pageKey: pageKeyFromModel(model),
    hash: model.hash,
    summary,
    sectionLines,
    navLines,
    interactiveLines,
    overlayLines,
    builtAt: Date.now(),
  };
}

export function computeTurnDelta(
  previous: PageModel | null,
  current: PageModel,
): TurnDelta {
  if (!previous) {
    return {
      hashChanged: true,
      previousHash: null,
      urlChanged: true,
      addedSectionIds: current.sections.map((s) => s.id),
      removedSectionIds: [],
      overlayChange: null,
      visibleShift: null,
    };
  }

  const prevIds = new Set(previous.sections.map((s) => s.id));
  const currIds = new Set(current.sections.map((s) => s.id));

  const addedSectionIds = current.sections
    .filter((s) => !prevIds.has(s.id))
    .map((s) => s.id);
  const removedSectionIds = previous.sections
    .filter((s) => !currIds.has(s.id))
    .map((s) => s.id);

  const prevVisible = previous.sections
    .filter((s) => s.isVisible)
    .map((s) => s.id)
    .join(',');
  const currVisible = current.sections
    .filter((s) => s.isVisible)
    .map((s) => s.id)
    .join(',');

  let overlayChange: string | null = null;
  const prevOverlays = previous.activeOverlays.filter((o) => o.isVisible);
  const currOverlays = current.activeOverlays.filter((o) => o.isVisible);
  if (prevOverlays.length !== currOverlays.length) {
    overlayChange = `Overlays: ${prevOverlays.length} → ${currOverlays.length}`;
  }

  return {
    hashChanged: previous.hash !== current.hash,
    previousHash: previous.hash,
    urlChanged: pageKeyFromModel(previous) !== pageKeyFromModel(current),
    addedSectionIds,
    removedSectionIds,
    overlayChange,
    visibleShift:
      prevVisible !== currVisible ? `Visible sections changed` : null,
  };
}

export function buildWorkingSet(
  model: PageModel,
  options?: { maxSections?: number; maxInteractives?: number },
): WorkingSet {
  const maxSections = options?.maxSections ?? 8;
  const maxInteractives = options?.maxInteractives ?? 10;

  const visibleSections = [...model.sections]
    .filter((s) => s.isVisible)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSections);

  const fallbackSections =
    visibleSections.length > 0
      ? visibleSections
      : [...model.sections].sort((a, b) => b.score - a.score).slice(0, maxSections);

  const topInteractives = model.interactiveElements
    .filter((el) => !el.isDisabled)
    .slice(0, maxInteractives);

  const visibleOverlays = model.activeOverlays.filter((o) => o.isVisible);

  return {
    visibleSections: fallbackSections,
    topInteractives,
    visibleOverlays,
  };
}

export function formatPageMemory(memory: PageMemory): string {
  const lines = [
    '# Page Memory',
    `Page: ${memory.summary}`,
    `Version hash: ${memory.hash}`,
    '',
    `## Sections (${memory.sectionLines.length})`,
    ...memory.sectionLines,
  ];

  if (memory.navLines.length > 0) {
    lines.push('', '## Navigation', ...memory.navLines);
  }

  if (memory.interactiveLines.length > 0) {
    lines.push('', '## Key interactives', ...memory.interactiveLines);
  }

  if (memory.overlayLines.length > 0) {
    lines.push('', '## Active overlays', ...memory.overlayLines);
  }

  lines.push(
    '',
    'Use readPageContent(sectionId) for full section detail not listed here.',
  );

  return lines.join('\n');
}

export function formatTurnDelta(delta: TurnDelta): string {
  if (
    !delta.hashChanged &&
    delta.addedSectionIds.length === 0 &&
    delta.removedSectionIds.length === 0 &&
    !delta.overlayChange &&
    !delta.visibleShift
  ) {
    return '# Page Delta\nNo structural changes since last turn.';
  }

  const lines = ['# Page Delta'];
  if (delta.hashChanged) {
    lines.push(`Page structure changed (hash ${delta.previousHash ?? 'none'} → updated).`);
  }
  if (delta.addedSectionIds.length > 0) {
    lines.push(`Added sections: ${delta.addedSectionIds.join(', ')}`);
  }
  if (delta.removedSectionIds.length > 0) {
    lines.push(`Removed sections: ${delta.removedSectionIds.join(', ')}`);
  }
  if (delta.overlayChange) lines.push(delta.overlayChange);
  if (delta.visibleShift) lines.push(delta.visibleShift);
  return lines.join('\n');
}

export function formatWorkingSet(set: WorkingSet): string {
  const lines = ['# Working Set (viewport-focused)'];

  if (set.visibleSections.length > 0) {
    lines.push('## Visible sections');
    for (const s of set.visibleSections) {
      lines.push(`- [${s.id}] ${s.label}: ${truncate(s.summary, 80)}`);
    }
  }

  if (set.topInteractives.length > 0) {
    lines.push('## Nearby interactives');
    for (const el of set.topInteractives) {
      lines.push(
        `- ${el.label} (${el.selector})${el.isDisabled ? ' [disabled]' : ''}`,
      );
    }
  }

  if (set.visibleOverlays.length > 0) {
    lines.push('## Open overlays');
    for (const o of set.visibleOverlays) {
      lines.push(`- ${o.type}: ${o.label}`);
    }
  }

  return lines.join('\n');
}

export function formatCrossOriginIframeNotice(model: PageModel): string | null {
  const frames = model.scanMetadata.crossOriginIframes;
  if (!frames || frames.length === 0) return null;

  const lines = [
    '# Embedded content limitations',
    `${frames.length} cross-origin iframe(s) detected — their content is NOT readable due to browser security.`,
    'Do not claim to see or interact with content inside cross-origin iframes.',
  ];

  for (const frame of frames.slice(0, 5)) {
    const label = frame.title ?? frame.src ?? `iframe ${frame.index}`;
    lines.push(`- ${label}`);
  }

  return lines.join('\n');
}

export class PageMemoryStore {
  private memory: PageMemory | null = null;
  private previousModel: PageModel | null = null;
  private siteIndex: SiteMemoryIndex = { pages: new Map(), routeSummaries: [] };

  prepare(model: PageModel): {
    memory: PageMemory;
    delta: TurnDelta;
    workingSet: WorkingSet;
    rebuilt: boolean;
  } {
    const pageKey = pageKeyFromModel(model);
    const delta = computeTurnDelta(this.previousModel, model);
    const rebuilt =
      !this.memory ||
      this.memory.pageKey !== pageKey ||
      this.memory.hash !== model.hash ||
      delta.urlChanged;

    if (rebuilt || !this.memory) {
      this.memory = buildPageMemory(model);
      this.siteIndex.pages.set(pageKey, this.memory);
      this.refreshSiteIndex();
    }

    this.previousModel = model;

    return {
      memory: this.memory,
      delta,
      workingSet: buildWorkingSet(model),
      rebuilt,
    };
  }

  clear(): void {
    this.memory = null;
    this.previousModel = null;
  }

  clearSite(): void {
    this.clear();
    this.siteIndex = { pages: new Map(), routeSummaries: [] };
  }

  getSiteIndexSummary(): string | null {
    if (this.siteIndex.routeSummaries.length <= 1) return null;
    return [
      '# Site pages visited this session',
      ...this.siteIndex.routeSummaries,
    ].join('\n');
  }

  private refreshSiteIndex(): void {
    this.siteIndex.routeSummaries = Array.from(this.siteIndex.pages.values()).map(
      (m) => `- ${m.pageKey}: ${m.summary}`,
    );
  }
}
