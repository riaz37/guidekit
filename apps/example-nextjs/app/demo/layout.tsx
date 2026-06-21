'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  platformDemoPlugin,
  platformKnowledgeDocuments,
} from '../../lib/guidekit-platform';
import { GuideKitDemoActions } from '../guidekit-demo-actions';
import { GuideKitTestBridge } from '../guidekit-test-bridge';

const GuideKitProvider = dynamic(
  () => import('@guidekit/react').then((mod) => mod.GuideKitProvider),
  { ssr: false },
);

/** Demo layout with cognitive engine enabled for E2E contract tests. */
export default function DemoLayout({ children }: { children: ReactNode }) {
  const router = useRouter();

  return (
    <GuideKitProvider
      tokenEndpoint="/api/guidekit/token"
      proxy={{
        llm: '/api/guidekit/llm',
        health: '/api/guidekit/health',
        stt: '/api/guidekit/stt',
        tts: '/api/guidekit/tts',
      }}
      llm={{ provider: 'gemini', model: 'gemini-2.5-flash-lite' }}
      intelligence={true}
      knowledge={{ documents: platformKnowledgeDocuments, engine: 'bm25', topK: 3 }}
      plugins={[platformDemoPlugin]}
      hallucinationGuard
      cognitive
      agent={{ name: 'GuideKit Cognitive Demo', greeting: 'Cognitive mode is enabled.' }}
      navigation={{ router }}
      options={{
        debug: process.env.NODE_ENV === 'development',
        mode: 'text',
        clickableSelectors: {
          allow: ['#name', '#email', '#message', 'input', 'textarea'],
        },
      }}
    >
      <GuideKitDemoActions />
      <GuideKitTestBridge />
      {children}
    </GuideKitProvider>
  );
}
