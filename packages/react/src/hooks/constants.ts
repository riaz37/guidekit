import type { GuideKitStore } from '@guidekit/core';

/** SSR-safe default snapshot returned when there is no GuideKitCore instance. */
export const SSR_SNAPSHOT: GuideKitStore = {
  status: { isReady: false, agentState: { status: 'idle' }, error: null },
  voice: { isListening: false, isSpeaking: false },
  hasConsent: false,
};

/** Noop subscriber for SSR — never fires, returns a stable unsubscribe. */
export const SSR_SUBSCRIBE = (_listener: () => void): (() => void) => () => {};

/** Stable default streaming state — avoids creating new objects on every render. */
export const SSR_STREAMING = { isStreaming: false, streamingText: '' } as const;
