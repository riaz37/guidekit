'use client';

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import {
  platformDemoPlugin,
  platformKnowledgeDocuments,
} from '../lib/guidekit-platform';

const GuideKitProvider = dynamic(
  () => import('@guidekit/react').then((mod) => mod.GuideKitProvider),
  { ssr: false },
);

export function Providers({ children }: { children: ReactNode }) {
  return (
    <GuideKitProvider
      tokenEndpoint="/api/guidekit/token"
      proxy={{ llm: '/api/guidekit/llm', health: '/api/guidekit/health' }}
      llm={{ provider: 'gemini', model: 'gemini-2.5-flash' }}
      intelligence
      knowledge={{ documents: platformKnowledgeDocuments, engine: 'bm25', topK: 3 }}
      plugins={[platformDemoPlugin]}
      hallucinationGuard
      agent={{ name: 'GuideKit Assistant', greeting: 'Hello! How can I help you today?' }}
      options={{ debug: process.env.NODE_ENV === 'development', mode: 'text' }}
    >
      {children}
    </GuideKitProvider>
  );
}
