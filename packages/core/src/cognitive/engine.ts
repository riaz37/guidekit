/**
 * @module @guidekit/core/cognitive/engine
 *
 * ReAct-style cognitive engine for complex multi-step queries.
 */

import type { ToolDefinition } from '../types/index.js';
import { QueryRouter, type QueryComplexity } from './query-router.js';
import { ModelRouter, type ModelTier } from './model-router.js';

export interface CognitiveStep {
  thought: string;
  action?: string;
  observation?: string;
}

export interface CognitiveResult {
  complexity: QueryComplexity;
  steps: CognitiveStep[];
  confidence: number;
  useStandardPipeline: boolean;
  /** Extra system prompt block for multi-step guidance. */
  systemPromptAddition?: string;
  /** Override tool loop depth for this turn. */
  maxToolRounds?: number;
  modelTier?: ModelTier;
  plannedActions?: string[];
}

export interface CognitiveEngineOptions {
  maxSteps?: number;
  voiceMode?: boolean;
  fastModel?: string;
  primaryModel?: string;
}

const STEP_PATTERNS: Array<{ pattern: RegExp; actions: string[] }> = [
  {
    pattern: /\btour\b|\bwalkthrough\b|\bshow\s+me\s+around\b|\bguide\s+me\s+(?:through|around)\b/i,
    actions: [
      'Pick ordered section IDs from the page context for the tour',
      'Call startTour with those sectionIds and mode "auto"',
      'Briefly introduce the tour, then let the visual steps advance',
    ],
  },
  {
    pattern: /\bcheckout\b/i,
    actions: [
      'Scan page for checkout or cart sections',
      'Highlight the primary checkout control',
      'Explain each required field before advancing',
      'Confirm success criteria with the user',
    ],
  },
  {
    pattern: /\bwalk\s+me\s+through\b|\bstep(?:s)?\s+(?:by\s+)?step\b/i,
    actions: [
      'Identify the relevant page sections for the task',
      'Highlight the first actionable element',
      'Execute one tool per step and observe results',
      'Summarize progress before the next step',
    ],
  },
  {
    pattern: /\bform\b|\bsubmit\b/i,
    actions: [
      'Locate the target form and validation state',
      'Highlight the first empty or errored field',
      'Guide field-by-field until submission is safe',
    ],
  },
];

export class CognitiveEngine {
  private readonly router: QueryRouter;
  private readonly modelRouter: ModelRouter;
  private readonly maxSteps: number;
  private readonly voiceMode: boolean;

  constructor(options: CognitiveEngineOptions = {}) {
    this.router = new QueryRouter();
    this.modelRouter = new ModelRouter({
      fastModel: options.fastModel,
      primaryModel: options.primaryModel,
    });
    this.maxSteps = options.maxSteps ?? 6;
    this.voiceMode = options.voiceMode ?? false;
  }

  /**
   * Plan a response strategy. Simple queries bypass the cognitive loop.
   */
  process(message: string, tools: ToolDefinition[]): CognitiveResult {
    const complexity = this.router.classify(message);
    const modelTier = this.modelRouter.select(complexity, this.voiceMode);

    if (complexity === 'simple') {
      return {
        complexity,
        steps: [],
        confidence: 0.95,
        useStandardPipeline: true,
        modelTier,
        maxToolRounds: 3,
      };
    }

    const plannedActions = this.planActions(message, tools);
    const steps: CognitiveStep[] = [
      {
        thought: `Query classified as ${complexity}. Decomposed into ${plannedActions.length} actions.`,
        action: 'plan',
      },
    ];

    for (let i = 0; i < plannedActions.length; i++) {
      steps.push({
        thought: plannedActions[i]!,
        action: `step_${i + 1}`,
        observation: i < plannedActions.length - 1 ? 'Continue after tool result.' : undefined,
      });
    }

    const systemPromptAddition = [
      '## Multi-Step Guidance Mode',
      'Execute this plan sequentially using tools. After each tool call, briefly explain what happened before continuing.',
      ...plannedActions.map((a, i) => `${i + 1}. ${a}`),
    ].join('\n');

    return {
      complexity,
      steps: steps.slice(0, this.maxSteps),
      confidence: complexity === 'complex' ? 0.78 : 0.88,
      useStandardPipeline: false,
      systemPromptAddition,
      maxToolRounds: complexity === 'complex' ? 8 : 5,
      modelTier,
      plannedActions,
    };
  }

  private planActions(message: string, tools: ToolDefinition[]): string[] {
    for (const { pattern, actions } of STEP_PATTERNS) {
      if (pattern.test(message)) return actions;
    }

    const toolNames = tools.slice(0, 4).map((t) => t.name);
    const toolHint =
      toolNames.length > 0
        ? `Prefer tools: ${toolNames.join(', ')}.`
        : 'Use highlight and scrollToSection as needed.';

    return [
      'Understand the user goal on the current page',
      `Identify the first UI element to act on. ${toolHint}`,
      'Execute one tool, observe the outcome, then proceed',
      'Confirm completion or ask a clarifying question',
    ];
  }
}
