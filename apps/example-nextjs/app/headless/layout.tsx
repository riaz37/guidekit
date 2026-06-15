'use client';

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import { GuideKitCustomUi } from '../guidekit-custom-ui';
import { GuideKitTestBridge } from '../guidekit-test-bridge';

const GuideKitProvider = dynamic(
  () => import('@guidekit/react').then((mod) => mod.GuideKitProvider),
  { ssr: false },
);

/** Headless demo layout — no built-in widget; custom UI only. */
export default function HeadlessLayout({ children }: { children: ReactNode }) {
  return (
    <GuideKitProvider
      headless
      tokenEndpoint="/api/guidekit/token"
      proxy={{
        llm: '/api/guidekit/llm',
        health: '/api/guidekit/health',
        stt: '/api/guidekit/stt',
        tts: '/api/guidekit/tts',
      }}
      llm={{ provider: 'gemini', model: 'gemini-2.5-flash-lite' }}
      intelligence={false}
      agent={{ name: 'Custom UI Demo', greeting: 'Hello from headless mode.' }}
      options={{
        debug: process.env.NODE_ENV === 'development',
        mode: 'text',
      }}
    >
      <GuideKitTestBridge />
      <GuideKitCustomUi />
      {children}
    </GuideKitProvider>
  );
}
