import { definePlugin } from '@guidekit/plugins';
import type { KnowledgeDocument, PluginDefinition } from '@guidekit/core';
import type { SiteKnowledgeDocument } from '@guidekit/server';

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

/** Server-backed website index for Agent Runtime / full-site context demo. */
export const platformSiteDocuments: SiteKnowledgeDocument[] = [
  {
    id: 'site-home',
    title: 'GuideKit Home',
    content:
      'GuideKit is an embeddable AI guide for websites. It understands page structure, answers questions, highlights UI, navigates same-origin pages, and can run developer-defined actions.',
    metadata: { url: '/' },
  },
  {
    id: 'site-about',
    title: 'About GuideKit',
    content:
      'GuideKit helps every web application become easier to navigate and understand. The assistant can explain product areas, guide users between pages, and stay beside the user as a website guide.',
    metadata: { url: '/about' },
  },
  {
    id: 'site-security',
    title: 'Security Model',
    content:
      'Production GuideKit integrations keep provider API keys server-side. The browser receives a short-lived JWT and sends LLM and site-search requests through protected proxy routes.',
    metadata: { url: '/demo', sectionId: 'security' },
  },
  {
    id: 'site-agent-runtime',
    title: 'Agent Runtime',
    content:
      'The Agent Runtime combines server-backed site knowledge, a live page model, and guided autonomy. Safe clicks, scrolling, highlighting, and same-origin navigation can run automatically, while submit, purchase, destructive, and auth actions require confirmation.',
    metadata: { url: '/demo', sectionId: 'agent-runtime' },
  },
  {
    id: 'site-pricing',
    title: 'Pricing',
    content:
      'GuideKit offers a Free plan at $0/month and a Pro plan at $29/month. Choose the plan that works for you.',
    metadata: { url: '/', sectionId: 'pricing' },
  },
];

/** Sample plugin demonstrating lifecycle hooks without polluting user-facing replies. */
export const platformDemoPlugin: PluginDefinition = definePlugin({
  name: 'platform-demo',
  version: '1.0.0',
  description: 'Platform Mode demo plugin (context provider + pipeline metadata)',
  hooks: {
    beforeLLMCall: async (ctx, next) => {
      ctx.metadata.platformDemo = true;
      return next();
    },
  },
  setup: (api) => {
    api.addContextProvider('demo-banner', () => 'Demo app: custom actions and proxy routes are enabled.');
  },
});
