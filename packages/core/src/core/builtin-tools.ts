/**
 * Built-in tool specifications and registration for GuideKitCore.
 */

import type { EventBus } from '../bus/index.js';
import type { DOMScanner } from '../dom/index.js';
import {
  assessDangerousClick,
  resolveElement,
  resolveFormFieldByLabel,
  resolveSectionSelector,
} from '../dom/element-resolver.js';
import { scrollAndRescan } from '../dom/rescan.js';
import type {
  AutonomyPolicy,
  ActionRisk,
  PageModel,
  SiteSearchResponse,
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
  getDomScanner?: () => DOMScanner | null;
  bus?: EventBus;
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
  autonomy?: AutonomyPolicy;
  siteKnowledge?: {
    search: (query: string, options?: { topK?: number }) => Promise<SiteSearchResponse>;
  };
}

type BuiltinSpec = ToolDefinition & {
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};

function emitResolve(
  host: BuiltinToolsHost,
  tool: string,
  result: { selector: string; confidence: number; reason: string },
): void {
  host.bus?.emit('element:resolve', {
    tool,
    selector: result.selector,
    confidence: result.confidence,
    reason: result.reason,
  });
}

const DEFAULT_AUTONOMY: Required<AutonomyPolicy> = {
  level: 'guided',
  allowNavigation: true,
  allowSafeClicks: true,
  requireConfirmationFor: ['submit', 'purchase', 'destructive', 'auth'],
};

function resolveAutonomy(policy?: AutonomyPolicy): Required<AutonomyPolicy> {
  return {
    ...DEFAULT_AUTONOMY,
    ...policy,
    requireConfirmationFor:
      policy?.requireConfirmationFor ?? DEFAULT_AUTONOMY.requireConfirmationFor,
  };
}

function findInteractiveRisk(model: PageModel | null, selector: string): ActionRisk {
  return (
    model?.interactiveElements.find((el) => el.selector === selector)?.actionRisk ?? 'unknown'
  );
}

function confirmationRequiredForRisk(policy: Required<AutonomyPolicy>, risk: ActionRisk): boolean {
  if (policy.level === 'ask-every-action') return true;
  if (policy.level === 'broad') return policy.requireConfirmationFor.includes(risk);
  if (risk === 'safe') return !policy.allowSafeClicks;
  return policy.requireConfirmationFor.includes(risk);
}

function setNativeInputValue(el: HTMLElement, value: string): void {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    const proto = Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
      setter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (el.isContentEditable) {
    el.textContent = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
}

function findFormFromChild(
  selector: string | undefined,
  label: string | undefined,
  model: PageModel | null,
): HTMLFormElement | null {
  if (typeof document === 'undefined') return null;
  if (selector) {
    const el = document.querySelector(selector);
    if (el instanceof HTMLFormElement) return el;
    if (el) return el.closest('form');
  }
  if (label && model) {
    const resolved = resolveFormFieldByLabel(model, label);
    if (resolved) {
      const el = document.querySelector(resolved.selector);
      if (el) return el.closest('form');
    }
  }
  return null;
}

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
        const model = host.getPageModel();
        let sectionId = args.sectionId as string | undefined;
        let selector = args.selector as string | undefined;

        if (model) {
          const resolved = resolveElement(model, { sectionId, selector, label: sectionId });
          if (resolved) {
            emitResolve(host, 'highlight', resolved);
            if (!selector) selector = resolved.selector;
            if (!sectionId && resolved.reason.startsWith('section:')) {
              sectionId = resolved.reason.slice('section:'.length);
            }
          }
        }

        const result = host.highlight({
          sectionId,
          selector,
          tooltip: args.tooltip as string | undefined,
          position: args.position as 'top' | 'bottom' | 'left' | 'right' | 'auto' | undefined,
        });
        return { success: result, selector, sectionId };
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
        const model = host.getPageModel();
        const rawId = args.sectionId as string;
        let sectionId = rawId;

        if (model) {
          const resolved = resolveSectionSelector(model, rawId);
          if (resolved) {
            emitResolve(host, 'scrollToSection', resolved);
            const match = model.sections.find((s) => s.selector === resolved.selector);
            if (match) sectionId = match.id;
          }
        }

        host.scrollToSection(sectionId, args.offset as number | undefined);
        return { success: true, sectionId };
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
        const autonomy = resolveAutonomy(host.autonomy);
        if (!autonomy.allowNavigation) {
          return { success: false, error: 'Navigation is disabled by autonomy policy.' };
        }
        const href = args.href as string;
        const result = await host.navigate(href);
        return { success: result, navigatedTo: result ? href : null };
      },
    },
    {
      name: 'searchSite',
      description:
        'Search server-backed website knowledge for content from any indexed page on the site.',
      parameters: {
        query: { type: 'string', description: 'Search query for website content' },
        topK: { type: 'number', description: 'Maximum number of results to return' },
      },
      required: ['query'],
      schemaVersion: 1,
      execute: async (args) => {
        const query = args.query as string | undefined;
        if (!query || query.trim().length === 0) {
          return { success: false, error: 'searchSite requires a query' };
        }
        if (!host.siteKnowledge) {
          return { success: false, error: 'Site knowledge is not configured.' };
        }
        return host.siteKnowledge.search(query, { topK: args.topK as number | undefined });
      },
    },
    {
      name: 'startTour',
      description:
        'Start a multi-step guided tour. REQUIRED when the user asks for a tour, walkthrough, or to be shown around the page. Highlights each section in order with step controls.',
      parameters: {
        sectionIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Section IDs from the page context, in tour visit order (minimum 2)',
        },
        mode: {
          type: 'string',
          enum: ['auto', 'manual'],
          description:
            'auto advances every few seconds (default); manual waits for user to click Next on the tooltip',
        },
      },
      required: ['sectionIds'],
      schemaVersion: 1,
      execute: async (args) => {
        const rawIds = args.sectionIds;
        const sectionIds = Array.isArray(rawIds)
          ? rawIds.map((id) => String(id)).filter(Boolean)
          : typeof rawIds === 'string' && rawIds.length > 0
            ? [rawIds]
            : [];
        if (sectionIds.length === 0) {
          return { success: false, error: 'startTour requires at least one sectionId' };
        }
        const mode = (args.mode as 'auto' | 'manual') ?? 'auto';
        host.startTour(sectionIds, mode);
        return { success: true, steps: sectionIds.length, mode };
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
        let model = host.getPageModel();
        if (!model) return { error: 'No page model available' };

        if (sectionId) {
          let section = model.sections.find((s) => s.id === sectionId);
          if (!section && model.scanMetadata.scanBudgetExhausted) {
            const scanner = host.getDomScanner?.();
            if (scanner) {
              model = await scrollAndRescan(scanner, { steps: 2 });
            }
            section = model.sections.find((s) => s.id === sectionId);
          }
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
          sections: model.sections
            .filter((s) => s.isVisible)
            .slice(0, 10)
            .map((s) => ({
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
        label: { type: 'string', description: 'Semantic label to resolve when selector is omitted' },
      },
      required: [],
      schemaVersion: 1,
      execute: async (args) => {
        if (typeof document === 'undefined') return { success: false, error: 'Not in browser' };

        const model = host.getPageModel();
        let selector = args.selector as string | undefined;
        const label = args.label as string | undefined;

        if (!selector && model) {
          const resolved = resolveElement(model, { label, sectionId: label });
          if (resolved) {
            emitResolve(host, 'clickElement', resolved);
            selector = resolved.selector;
          }
        }

        if (!selector) {
          return { success: false, error: 'Provide selector or label' };
        }

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

        const autonomy = resolveAutonomy(host.autonomy);
        const risk = findInteractiveRisk(model, selector);
        const requiresConfirmation = confirmationRequiredForRisk(autonomy, risk);

        if (!isInDevAllowList) {
          const defaultDenied = DEFAULT_CLICK_DENY.some((pattern) => {
            try {
              return el.matches(pattern);
            } catch {
              return false;
            }
          });
          if (defaultDenied) {
            if (requiresConfirmation) {
              host.bus?.emit('action:confirmation-required', {
                selector,
                risk,
                reason: `Action risk "${risk}" requires confirmation by autonomy policy.`,
              });
              return {
                success: false,
                error: `Action risk "${risk}" requires confirmation by autonomy policy.`,
                confirmationRequired: true,
                risk,
              };
            }
            return {
              success: false,
              error: `Selector "${selector}" matches the default deny list. Add it to clickableSelectors.allow to override.`,
            };
          }
        }

        if (rules?.allow?.length && !isInDevAllowList) {
          return {
            success: false,
            error: `Selector "${selector}" is not in the allowed clickable selectors list.`,
          };
        }

        if (requiresConfirmation) {
          host.bus?.emit('action:confirmation-required', {
            selector,
            risk,
            reason: `Action risk "${risk}" requires confirmation by autonomy policy.`,
          });
          return {
            success: false,
            error: `Action risk "${risk}" requires confirmation by autonomy policy.`,
            confirmationRequired: true,
            risk,
          };
        }

        const danger = assessDangerousClick(selector, el);
        if (danger.blocked) {
          host.bus?.emit('action:confirmation-required', {
            selector,
            risk,
            reason: danger.reason,
          });
          return {
            success: false,
            error: danger.reason ?? 'Dangerous action blocked pending user confirmation.',
            confirmationRequired: true,
          };
        }

        el.click();
        return { success: true };
      },
    },
    {
      name: 'fillInput',
      description:
        'Fill an input field, textarea, or contenteditable element with a text value. Use this when the user wants to type into a form field. Dispatches native input and change events so JavaScript frameworks detect the change.',
      parameters: {
        selector: { type: 'string', description: 'CSS selector of the input to fill' },
        label: { type: 'string', description: 'Semantic label to resolve when selector is omitted (e.g. "email", "name", "message")' },
        value: { type: 'string', description: 'Text value to set on the field' },
      },
      required: ['value'],
      schemaVersion: 1,
      execute: async (args) => {
        if (typeof document === 'undefined') return { success: false, error: 'Not in browser' };

        const model = host.getPageModel();
        let selector = args.selector as string | undefined;
        const label = args.label as string | undefined;
        const value = (args.value as string) ?? '';

        if (!selector && model) {
          const resolved = label
            ? resolveElement(model, { label })
            : null;
          if (!resolved) {
            const fieldResolved = label ? resolveFormFieldByLabel(model, label) : null;
            if (fieldResolved) {
              emitResolve(host, 'fillInput', fieldResolved);
              selector = fieldResolved.selector;
            }
          } else {
            emitResolve(host, 'fillInput', resolved);
            selector = resolved.selector;
          }
        }

        if (!selector) return { success: false, error: 'Provide selector or label' };

        const el = document.querySelector(selector);
        if (!el) return { success: false, error: `Element not found: ${selector}` };
        if (!(el instanceof HTMLElement)) return { success: false, error: 'Element is not an HTML element' };

        const tag = el.tagName.toLowerCase();
        const isInput = tag === 'input' || tag === 'textarea';
        const isContentEditable = el.isContentEditable;
        if (!isInput && !isContentEditable) {
          return { success: false, error: `Element is not a fillable input: ${tag}` };
        }

        if (isInput) {
          const input = el as HTMLInputElement | HTMLTextAreaElement;
          if (input.disabled) return { success: false, error: 'Input is disabled' };
          if (input.readOnly) return { success: false, error: 'Input is read-only' };
        }

        el.focus();
        setNativeInputValue(el, value);
        el.blur();

        return { success: true, selector, filled: true };
      },
    },
    {
      name: 'selectOption',
      description:
        'Select an option from a <select> dropdown element by option value or visible text. Dispatches a native change event so JavaScript frameworks detect the selection.',
      parameters: {
        selector: { type: 'string', description: 'CSS selector of the select element' },
        label: { type: 'string', description: 'Semantic label to resolve when selector is omitted (e.g. "country", "category")' },
        option: { type: 'string', description: 'Value or visible text of the option to select' },
      },
      required: ['option'],
      schemaVersion: 1,
      execute: async (args) => {
        if (typeof document === 'undefined') return { success: false, error: 'Not in browser' };

        const model = host.getPageModel();
        let selector = args.selector as string | undefined;
        const label = args.label as string | undefined;
        const option = (args.option as string) ?? '';

        if (!selector && model) {
          const resolved = label
            ? resolveElement(model, { label })
            : null;
          if (!resolved) {
            const fieldResolved = label ? resolveFormFieldByLabel(model, label) : null;
            if (fieldResolved) {
              emitResolve(host, 'selectOption', fieldResolved);
              selector = fieldResolved.selector;
            }
          } else {
            emitResolve(host, 'selectOption', resolved);
            selector = resolved.selector;
          }
        }

        if (!selector) return { success: false, error: 'Provide selector or label' };

        const el = document.querySelector(selector);
        if (!el) return { success: false, error: `Element not found: ${selector}` };
        if (!(el instanceof HTMLSelectElement)) {
          return { success: false, error: 'Element is not a <select>' };
        }
        if (el.disabled) return { success: false, error: 'Select is disabled' };

        const optionNorm = option.trim().toLowerCase();
        let foundIndex = -1;

        for (let i = 0; i < el.options.length; i++) {
          const opt = el.options[i];
          if (!opt) continue;
          if (
            opt.value.toLowerCase() === optionNorm ||
            opt.text.trim().toLowerCase() === optionNorm ||
            opt.label.trim().toLowerCase() === optionNorm
          ) {
            foundIndex = i;
            break;
          }
        }

        if (foundIndex === -1) {
          return {
            success: false,
            error: `Option "${option}" not found. Available: ${Array.from(el.options).map((o) => `"${o.text}"`).join(', ')}`,
          };
        }

        el.selectedIndex = foundIndex;
        el.dispatchEvent(new Event('change', { bubbles: true }));

        return { success: true, selector, selected: el.options[foundIndex]!.value };
      },
    },
    {
      name: 'submitForm',
      description:
        'Submit a form. Finds the nearest form from a selector or label, or submit button. Uses the native form submission API (requestSubmit when available) which triggers validation and submit events. Respects the autonomy policy and may require user confirmation.',
      parameters: {
        selector: { type: 'string', description: 'CSS selector for the form or a button/input inside the form' },
        label: { type: 'string', description: 'Semantic label to resolve (e.g. "contact form", "sign up form")' },
      },
      required: [],
      schemaVersion: 1,
      execute: async (args) => {
        if (typeof document === 'undefined') return { success: false, error: 'Not in browser' };

        const model = host.getPageModel();
        const selector = args.selector as string | undefined;
        const label = args.label as string | undefined;

        let form: HTMLFormElement | null = null;

        if (selector) {
          const el = document.querySelector(selector);
          if (el instanceof HTMLFormElement) {
            form = el;
          } else if (el) {
            form = el.closest('form');
          }
        }

        if (!form && label && model) {
          form = findFormFromChild(undefined, label, model);
        }

        if (!form) {
          if (model && model.forms.length > 0) {
            const firstForm = document.querySelector(model.forms[0]!.selector);
            if (firstForm instanceof HTMLFormElement) {
              form = firstForm;
            }
          }
        }

        if (!form) return { success: false, error: 'No form found. Provide a selector or label.' };

        const autonomy = resolveAutonomy(host.autonomy);
        const requiresConfirmation = confirmationRequiredForRisk(autonomy, 'submit');

        if (requiresConfirmation) {
          host.bus?.emit('action:confirmation-required', {
            selector: model?.forms.find((f) => f.selector === selector)?.selector ?? form.id ?? 'unknown',
            risk: 'submit',
            reason: 'Form submission requires confirmation by autonomy policy.',
          });
          return {
            success: false,
            error: 'Form submission requires confirmation by autonomy policy.',
            confirmationRequired: true,
            risk: 'submit',
          };
        }

        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else {
          form.submit();
        }

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
