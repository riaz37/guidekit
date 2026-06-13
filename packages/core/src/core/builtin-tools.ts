/**
 * Built-in tool specifications and registration for GuideKitCore.
 */

import type {
  PageModel,
  ToolDefinition,
  ToolParameterSchema,
} from '../types/index.js';
import type { ContextManager } from '../context/index.js';
import type { ToolExecutor } from '../llm/tool-executor.js';
import type { VisualGuidanceApi } from './visual-api.js';

export const DEFAULT_CLICK_DENY = [
  '[type="submit"]',
  '[type="reset"]',
  'button[formaction]',
  '[data-guidekit-no-click]',
  'form',
];

export interface BuiltinToolsHost extends VisualGuidanceApi {
  getPageModel(): PageModel | null;
  contextManager: ContextManager;
  customActions: Map<
    string,
    {
      description: string;
      parameters: Record<string, unknown>;
      handler: (params: Record<string, unknown>) => Promise<unknown>;
    }
  >;
  clickableSelectors?: { allow?: string[]; deny?: string[] };
}

type BuiltinSpec = ToolDefinition & {
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};

export function getBuiltinToolSpecs(host: BuiltinToolsHost): BuiltinSpec[] {
  return [
    {
      name: 'highlight',
      description:
        'Spotlight an element on the page to draw the user\'s attention. Use sectionId to highlight a page section, or selector for a specific CSS selector. Optionally add a tooltip with explanation text.',
      parameters: {
        sectionId: { type: 'string', description: 'ID of the section to highlight' },
        selector: { type: 'string', description: 'CSS selector (overrides sectionId)' },
        tooltip: { type: 'string', description: 'Text to show in tooltip' },
        position: {
          type: 'string',
          enum: ['top', 'bottom', 'left', 'right', 'auto'],
          description: 'Tooltip position',
        },
      },
      required: [],
      schemaVersion: 1,
      execute: async (args) => {
        const result = host.highlight({
          sectionId: args.sectionId as string | undefined,
          selector: args.selector as string | undefined,
          tooltip: args.tooltip as string | undefined,
          position: args.position as 'top' | 'bottom' | 'left' | 'right' | 'auto' | undefined,
        });
        return { success: result };
      },
    },
    {
      name: 'dismissHighlight',
      description: 'Remove the current spotlight overlay.',
      parameters: {},
      required: [],
      schemaVersion: 1,
      execute: async () => {
        host.dismissHighlight();
        return { success: true };
      },
    },
    {
      name: 'scrollToSection',
      description: 'Smooth scroll to a section by its ID. Use offset to account for sticky headers.',
      parameters: {
        sectionId: { type: 'string', description: 'ID of the section to scroll to' },
        offset: { type: 'number', description: 'Pixel offset for sticky headers' },
      },
      required: ['sectionId'],
      schemaVersion: 1,
      execute: async (args) => {
        host.scrollToSection(args.sectionId as string, args.offset as number | undefined);
        return { success: true };
      },
    },
    {
      name: 'navigate',
      description:
        'Navigate to a different page within the same site. Only same-origin URLs are allowed.',
      parameters: {
        href: { type: 'string', description: 'URL or path to navigate to (same-origin only)' },
      },
      required: ['href'],
      schemaVersion: 1,
      execute: async (args) => {
        const href = args.href as string;
        const result = await host.navigate(href);
        return { success: result, navigatedTo: result ? href : null };
      },
    },
    {
      name: 'startTour',
      description: 'Start a guided tour through multiple sections in sequence.',
      parameters: {
        sectionIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Section IDs in tour order',
        },
        mode: {
          type: 'string',
          enum: ['auto', 'manual'],
          description: 'auto advances automatically; manual waits for user',
        },
      },
      required: ['sectionIds'],
      schemaVersion: 1,
      execute: async (args) => {
        const sectionIds = args.sectionIds as string[];
        const mode = (args.mode as 'auto' | 'manual') ?? 'manual';
        host.startTour(sectionIds, mode);
        return { success: true, steps: sectionIds.length };
      },
    },
    {
      name: 'readPageContent',
      description:
        'Read visible text content of a section by ID, or search across all sections by keyword.',
      parameters: {
        sectionId: { type: 'string', description: 'Section ID to read' },
        query: { type: 'string', description: 'Keyword to search for across sections' },
      },
      required: [],
      schemaVersion: 1,
      execute: async (args) => {
        const sectionId = args.sectionId as string | undefined;
        const query = args.query as string | undefined;
        const model = host.getPageModel();
        if (!model) return { error: 'No page model available' };

        if (sectionId) {
          const section = model.sections.find((s) => s.id === sectionId);
          if (section) {
            const contentMapResult = await host.contextManager.getContent(sectionId);
            return {
              sectionId: section.id,
              label: section.label,
              summary: section.summary,
              contentMap: contentMapResult,
            };
          }
          return { error: `Section "${sectionId}" not found` };
        }

        if (query) {
          const queryLower = query.toLowerCase();
          const matches = model.sections.filter(
            (s) =>
              s.label?.toLowerCase().includes(queryLower) ||
              s.summary?.toLowerCase().includes(queryLower),
          );
          return {
            query,
            results: matches.slice(0, 5).map((s) => ({
              sectionId: s.id,
              label: s.label,
              snippet: s.summary?.slice(0, 200),
            })),
          };
        }

        return { error: 'Provide either sectionId or query' };
      },
    },
    {
      name: 'getVisibleSections',
      description: 'Get the list of sections currently visible in the user viewport.',
      parameters: {},
      required: [],
      schemaVersion: 1,
      execute: async () => {
        const model = host.getPageModel();
        if (!model) return { sections: [] };
        return {
          sections: model.sections.slice(0, 10).map((s) => ({
            id: s.id,
            label: s.label,
            selector: s.selector,
            score: s.score,
          })),
        };
      },
    },
    {
      name: 'clickElement',
      description: 'Programmatically click an interactive element on the page.',
      parameters: {
        selector: { type: 'string', description: 'CSS selector of the element to click' },
      },
      required: ['selector'],
      schemaVersion: 1,
      execute: async (args) => {
        if (typeof document === 'undefined') return { success: false, error: 'Not in browser' };
        const selector = args.selector as string;
        const el = document.querySelector(selector);
        if (!el) return { success: false, error: `Element not found: ${selector}` };
        if (!(el instanceof HTMLElement)) {
          return { success: false, error: 'Element is not clickable' };
        }

        const rules = host.clickableSelectors;
        const isInDevAllowList =
          rules?.allow?.some((pattern) => {
            try {
              return el.matches(pattern);
            } catch {
              return selector === pattern;
            }
          }) ?? false;

        if (!isInDevAllowList) {
          const defaultDenied = DEFAULT_CLICK_DENY.some((pattern) => {
            try {
              return el.matches(pattern);
            } catch {
              return false;
            }
          });
          if (defaultDenied) {
            return {
              success: false,
              error: `Selector "${selector}" matches the default deny list. Add it to clickableSelectors.allow to override.`,
            };
          }
        }

        if (rules?.deny?.length) {
          const denied = rules.deny.some((pattern) => {
            try {
              return el.matches(pattern);
            } catch {
              return selector === pattern;
            }
          });
          if (denied) {
            return { success: false, error: `Selector "${selector}" is blocked by the deny list.` };
          }
        }

        if (rules?.allow?.length && !isInDevAllowList) {
          return {
            success: false,
            error: `Selector "${selector}" is not in the allowed clickable selectors list.`,
          };
        }

        el.click();
        return { success: true };
      },
    },
    {
      name: 'executeCustomAction',
      description:
        'Execute a developer-registered custom action (e.g., add to cart, submit form).',
      parameters: {
        actionId: { type: 'string', description: 'ID of the custom action' },
        params: { type: 'object', description: 'Parameters for the action' },
      },
      required: ['actionId'],
      schemaVersion: 1,
      execute: async (args) => {
        const actionId = args.actionId as string;
        const params = (args.params as Record<string, unknown>) ?? {};
        const action = host.customActions.get(actionId);
        if (!action) return { error: `Unknown action: ${actionId}` };
        try {
          const result = await action.handler(params);
          return { success: true, result };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
  ];
}

export function registerBuiltinTools(
  host: BuiltinToolsHost,
  toolExecutor: ToolExecutor | null,
): void {
  if (!toolExecutor) return;
  for (const spec of getBuiltinToolSpecs(host)) {
    toolExecutor.registerTool({ name: spec.name, execute: spec.execute });
  }
}

export function collectToolDefinitions(
  host: BuiltinToolsHost,
  extraTools: ToolDefinition[],
): ToolDefinition[] {
  const builtinTools: ToolDefinition[] = getBuiltinToolSpecs(host).map(
    ({ execute: _execute, ...def }) => def,
  );

  for (const [actionId, action] of host.customActions) {
    builtinTools.push({
      name: `action_${actionId}`,
      description: action.description,
      parameters: action.parameters as Record<string, ToolParameterSchema>,
      schemaVersion: 1,
    });
  }

  return [...builtinTools, ...extraTools];
}
