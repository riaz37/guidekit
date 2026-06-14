import { definePlugin } from '@guidekit/plugins';
import type { KnowledgeDocument, PluginDefinition } from '@guidekit/core';

/** Sample knowledge base for Platform Mode demo. */
export const platformKnowledgeDocuments: KnowledgeDocument[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    content:
      'GuideKit Platform Mode combines semantic page intelligence, knowledge retrieval, and plugins. ' +
      'Use the chat widget to ask about page sections, highlight elements, or navigate the demo app.',
    metadata: { tags: ['platform', 'demo'] },
  },
  {
    id: 'security',
    title: 'Security',
    content:
      'In production, API keys are stored server-side only. The client receives a short-lived JWT ' +
      'and sends requests through the LLM proxy at /api/guidekit/llm.',
    metadata: { tags: ['security', 'proxy'] },
  },
];

/** Sample plugin demonstrating multiple lifecycle hooks. */
export const platformDemoPlugin: PluginDefinition = definePlugin({
  name: 'platform-demo',
  version: '1.0.0',
  description: 'Adds platform mode demo context and post-response metadata',
  hooks: {
    beforeLLMCall: async (ctx, next) => {
      ctx.systemPrompt +=
        '\n\n## Platform Mode\nThis app runs GuideKit Platform Mode with intelligence, RAG, and plugins enabled.';
      ctx.metadata.platformDemo = true;
      return next();
    },
    afterLLMCall: async (ctx, next) => {
      if (ctx.responseText && !ctx.responseText.includes('[Platform Mode]')) {
        ctx.responseText = `${ctx.responseText}\n\n[Platform Mode] Response validated by platform-demo plugin.`;
      }
      return next();
    },
  },
  setup: (api) => {
    api.addContextProvider('demo-banner', () => 'Demo app: custom actions and proxy routes are enabled.');
  },
});
