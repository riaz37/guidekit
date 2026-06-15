'use client';

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import {
  platformDemoPlugin,
  platformKnowledgeDocuments,
} from '../lib/guidekit-platform';
import { GuideKitDemoActions } from './guidekit-demo-actions';

const GuideKitProvider = dynamic(
  () => import('@guidekit/react').then((mod) => mod.GuideKitProvider),
  { ssr: false },
);

// Voice is on by default in the example app (Web Speech + @guidekit/vad). Set NEXT_PUBLIC_GUIDEKIT_VOICE=0 to disable.
const voiceEnabled = process.env.NEXT_PUBLIC_GUIDEKIT_VOICE !== '0';

export function Providers({ children }: { children: ReactNode }) {
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
      agent={{ name: 'GuideKit Assistant', greeting: 'Hello! How can I help you today?' }}
      options={{
        debug: process.env.NODE_ENV === 'development',
        mode: voiceEnabled ? 'voice' : 'text',
      }}
    >
      <GuideKitDemoActions />
      {children}
    </GuideKitProvider>
  );
}
