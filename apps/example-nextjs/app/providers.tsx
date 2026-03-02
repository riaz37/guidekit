'use client';

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';

const GuideKitProvider = dynamic(
  () => import('@guidekit/react').then((mod) => mod.GuideKitProvider),
  { ssr: false },
);

export function Providers({ children }: { children: ReactNode }) {
  return (
    <GuideKitProvider
      tokenEndpoint="/api/guidekit/token"
      agent={{ name: 'GuideKit Assistant', greeting: 'Hello! How can I help you today?' }}
      options={{ debug: process.env.NODE_ENV === 'development', mode: 'text' }}
    >
      {children}
    </GuideKitProvider>
  );
}
