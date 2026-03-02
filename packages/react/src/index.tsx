// ---------------------------------------------------------------------------
// @guidekit/react — React bindings for GuideKit SDK
// ---------------------------------------------------------------------------
//
// Provides: GuideKitProvider, split hooks (useGuideKitStatus, useGuideKitVoice,
// useGuideKitActions, useGuideKitContext), combined useGuideKit hook, and an
// internal GuideKitWidget rendered inside Shadow DOM.
//
// All hooks use React 18's useSyncExternalStore for tear-free, concurrent-mode
// safe reads from the GuideKitCore store. Functions are memoised with
// useCallback so they are referentially stable across renders.
// ---------------------------------------------------------------------------

import { GuideKitCore } from '@guidekit/core';
import type {
  GuideKitCoreOptions,
  GuideKitProviderProps,
  AgentState,
  GuideKitStore,
  GuideKitErrorType,
  GuideKitEvent,
} from '@guidekit/core';

import React, {
  useContext,
  useEffect,
  useRef,
  useCallback,
  useSyncExternalStore,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import { GuideKitContext } from './_context.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** SSR-safe default snapshot returned when there is no GuideKitCore instance. */
const SSR_SNAPSHOT: GuideKitStore = {
  status: { isReady: false, agentState: { status: 'idle' }, error: null },
  voice: { isListening: false, isSpeaking: false },
  hasConsent: false,
};

/** Noop subscriber for SSR — never fires, returns a stable unsubscribe. */
const SSR_SUBSCRIBE = (_listener: () => void): (() => void) => () => {};

// ---------------------------------------------------------------------------
// Internal hook: access the core instance from context
// ---------------------------------------------------------------------------

function useGuideKitCore(): GuideKitCore | null {
  return useContext(GuideKitContext);
}

// ---------------------------------------------------------------------------
// GuideKitProvider
// ---------------------------------------------------------------------------

export function GuideKitProvider(
  props: GuideKitProviderProps & { children: ReactNode },
) {
  const {
    children,
    tokenEndpoint,
    stt,
    tts,
    llm,
    agent,
    contentMap,
    options,
    theme,
    locale: _locale,
    instanceId,
    rootElement,
    onError,
    onEvent,
    onReady,
    onBeforeLLMCall,
  } = props;

  // Use a ref so the core instance is created once and never causes re-renders.
  // We also track whether the ref was initialised to avoid re-creating after
  // React StrictMode's double-mount (SingletonGuard handles concurrency, but
  // we still want to be explicit).
  const coreRef = useRef<GuideKitCore | null>(null);
  const initCalled = useRef(false);

  // Build the options object. We memoise the option values but the core is
  // created imperatively, not via state — this avoids render-triggered side
  // effects.
  if (coreRef.current === null) {
    const coreOptions: GuideKitCoreOptions = {
      tokenEndpoint,
      stt,
      tts,
      llm,
      agent,
      contentMap,
      options,
      instanceId,
      rootElement,
      onError,
      onEvent,
      onReady,
      onBeforeLLMCall,
    };
    coreRef.current = new GuideKitCore(coreOptions);
  }

  // init() on mount, destroy() on unmount.
  useEffect(() => {
    const core = coreRef.current;
    if (!core) return;

    // SSR guard
    if (typeof window === 'undefined') return;

    // Prevent double-init in StrictMode. The SingletonGuard in core also
    // protects against this, but this flag avoids the extra async call.
    if (initCalled.current) return;
    initCalled.current = true;

    core.init().catch((initErr: unknown) => {
      if (options?.debug) {
        console.error('[GuideKit:React] init() failed', initErr);
      }
      if (initErr && typeof initErr === 'object' && 'message' in initErr) {
        onError?.(initErr as GuideKitErrorType);
      }
    });

    return () => {
      initCalled.current = false;
      core.destroy().catch((destroyErr: unknown) => {
        if (options?.debug) {
          console.error('[GuideKit:React] destroy() failed', destroyErr);
        }
      });
    };
  }, []);

  return (
    <GuideKitContext.Provider value={coreRef.current}>
      {children}
      <GuideKitWidget theme={theme} consentRequired={options?.consentRequired} instanceId={instanceId} />
    </GuideKitContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Split Hook: useGuideKitStatus
// ---------------------------------------------------------------------------

export function useGuideKitStatus(): {
  isReady: boolean;
  agentState: AgentState;
  error: GuideKitErrorType | null;
} {
  const core = useGuideKitCore();

  const subscribe = useCallback(
    (listener: () => void) =>
      core ? core.subscribe(listener) : SSR_SUBSCRIBE(listener),
    [core],
  );

  const getSnapshot = useCallback(
    () => (core ? core.getSnapshot().status : SSR_SNAPSHOT.status),
    [core],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => SSR_SNAPSHOT.status);
}

// ---------------------------------------------------------------------------
// Split Hook: useGuideKitVoice
// ---------------------------------------------------------------------------

export function useGuideKitVoice(): {
  isListening: boolean;
  isSpeaking: boolean;
  startListening: () => void;
  stopListening: () => void;
  sendText: (text: string) => Promise<string>;
} {
  const core = useGuideKitCore();

  const subscribe = useCallback(
    (listener: () => void) =>
      core ? core.subscribe(listener) : SSR_SUBSCRIBE(listener),
    [core],
  );

  const getSnapshot = useCallback(
    () => (core ? core.getSnapshot().voice : SSR_SNAPSHOT.voice),
    [core],
  );

  const voiceSlice = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => SSR_SNAPSHOT.voice,
  );

  const startListening = useCallback(() => {
    if (core) {
      core.startListening().catch((err) => {
        console.error('[GuideKit] Failed to start listening:', err);
      });
    }
  }, [core]);

  const stopListening = useCallback(() => {
    if (core) {
      core.stopListening();
    }
  }, [core]);

  const sendText = useCallback(
    (text: string): Promise<string> => {
      if (!core) {
        return Promise.reject(
          new Error('GuideKit not initialised. Wrap your app in <GuideKitProvider>.'),
        );
      }
      return core.sendText(text);
    },
    [core],
  );

  return {
    ...voiceSlice,
    startListening,
    stopListening,
    sendText,
  };
}

// ---------------------------------------------------------------------------
// Split Hook: useGuideKitActions
// ---------------------------------------------------------------------------

export function useGuideKitActions(): {
  highlight: (
    sectionId: string,
    options?: { selector?: string; tooltip?: string; position?: string },
  ) => void;
  dismissHighlight: () => void;
  scrollToSection: (sectionId: string, offset?: number) => void;
  startTour: (sectionIds: string[], mode?: 'auto' | 'manual') => void;
  navigate: (href: string) => void;
} {
  const core = useGuideKitCore();

  const highlight = useCallback(
    (
      sectionId: string,
      options?: { selector?: string; tooltip?: string; position?: string },
    ) => {
      core?.highlight({
        sectionId,
        selector: options?.selector,
        tooltip: options?.tooltip,
        position: options?.position as 'top' | 'bottom' | 'left' | 'right' | 'auto' | undefined,
      });
    },
    [core],
  );

  const dismissHighlight = useCallback(() => {
    core?.dismissHighlight();
  }, [core]);

  const scrollToSection = useCallback(
    (sectionId: string, offset?: number) => {
      core?.scrollToSection(sectionId, offset);
    },
    [core],
  );

  const startTour = useCallback(
    (sectionIds: string[], mode?: 'auto' | 'manual') => {
      core?.startTour(sectionIds, mode);
    },
    [core],
  );

  const navigate = useCallback(
    (href: string) => {
      core?.navigate(href).catch((err) => {
        console.error('[GuideKit] Navigation failed:', err);
      });
    },
    [core],
  );

  return { highlight, dismissHighlight, scrollToSection, startTour, navigate };
}

// ---------------------------------------------------------------------------
// Split Hook: useGuideKitContext
// ---------------------------------------------------------------------------

export function useGuideKitContext(): {
  setPageContext: (context: Record<string, unknown>) => void;
  addContext: (key: string, value: unknown) => void;
  registerAction: (
    actionId: string,
    action: {
      description: string;
      parameters: Record<string, unknown>;
      handler: (params: Record<string, unknown>) => Promise<unknown>;
    },
  ) => void;
} {
  const core = useGuideKitCore();

  const setPageContext = useCallback(
    (context: Record<string, unknown>) => {
      core?.setPageContext(context);
    },
    [core],
  );

  const addContext = useCallback(
    (key: string, value: unknown) => {
      core?.setPageContext({ [key]: value });
    },
    [core],
  );

  const registerAction = useCallback(
    (
      actionId: string,
      action: {
        description: string;
        parameters: Record<string, unknown>;
        handler: (params: Record<string, unknown>) => Promise<unknown>;
      },
    ) => {
      core?.registerAction(actionId, action);
    },
    [core],
  );

  return { setPageContext, addContext, registerAction };
}

// ---------------------------------------------------------------------------
// Combined Hook: useGuideKit
// ---------------------------------------------------------------------------

export function useGuideKit(): {
  isReady: boolean;
  agentState: AgentState;
  error: GuideKitErrorType | null;
  isListening: boolean;
  isSpeaking: boolean;
  startListening: () => void;
  stopListening: () => void;
  sendText: (text: string) => Promise<string>;
  highlight: (
    sectionId: string,
    options?: { selector?: string; tooltip?: string; position?: string },
  ) => void;
  dismissHighlight: () => void;
  scrollToSection: (sectionId: string, offset?: number) => void;
  startTour: (sectionIds: string[], mode?: 'auto' | 'manual') => void;
  navigate: (href: string) => void;
  setPageContext: (context: Record<string, unknown>) => void;
  addContext: (key: string, value: unknown) => void;
  registerAction: (
    actionId: string,
    action: {
      description: string;
      parameters: Record<string, unknown>;
      handler: (params: Record<string, unknown>) => Promise<unknown>;
    },
  ) => void;
} {
  const status = useGuideKitStatus();
  const voice = useGuideKitVoice();
  const actions = useGuideKitActions();
  const ctx = useGuideKitContext();

  return {
    ...status,
    ...voice,
    ...actions,
    ...ctx,
  };
}

// ---------------------------------------------------------------------------
// Transcript message type (internal)
// ---------------------------------------------------------------------------

interface TranscriptMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// CSS for the widget (injected into Shadow DOM)
// ---------------------------------------------------------------------------

const WIDGET_STYLES = /* css */ `
  :host {
    --gk-primary: #6366f1;
    --gk-primary-hover: #4f46e5;
    --gk-primary-active: #4338ca;
    --gk-bg: #ffffff;
    --gk-bg-secondary: #f8fafc;
    --gk-text: #1e293b;
    --gk-text-secondary: #64748b;
    --gk-border: #e2e8f0;
    --gk-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
    --gk-radius: 16px;
    --gk-fab-size: 56px;
    --gk-panel-width: 380px;
    --gk-panel-height: 520px;
    --gk-font: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

    all: initial;
    font-family: var(--gk-font);
    position: fixed;
    z-index: 2147483647;
    bottom: 24px;
    right: 24px;
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }

  /* ----- Floating Action Button ----- */

  .gk-fab {
    width: var(--gk-fab-size);
    height: var(--gk-fab-size);
    border-radius: 50%;
    border: none;
    background: var(--gk-primary);
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 16px rgba(99, 102, 241, 0.35);
    transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.15s ease;
    outline: none;
    position: relative;
  }

  .gk-fab:hover {
    background: var(--gk-primary-hover);
    transform: scale(1.05);
    box-shadow: 0 6px 24px rgba(99, 102, 241, 0.45);
  }

  .gk-fab:active {
    background: var(--gk-primary-active);
    transform: scale(0.97);
  }

  .gk-fab:focus-visible {
    outline: 2px solid var(--gk-primary);
    outline-offset: 3px;
  }

  .gk-fab svg {
    width: 24px;
    height: 24px;
    fill: currentColor;
    transition: transform 0.2s ease;
  }

  .gk-fab[aria-expanded="true"] svg {
    transform: rotate(45deg);
  }

  /* ----- Panel ----- */

  .gk-panel {
    position: absolute;
    bottom: calc(var(--gk-fab-size) + 16px);
    right: 0;
    width: var(--gk-panel-width);
    height: var(--gk-panel-height);
    background: var(--gk-bg);
    border-radius: var(--gk-radius);
    box-shadow: var(--gk-shadow);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    opacity: 0;
    transform: translateY(12px) scale(0.95);
    pointer-events: none;
    transition: opacity 0.2s ease, transform 0.2s ease;
  }

  .gk-panel[data-open="true"] {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }

  /* ----- Header ----- */

  .gk-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--gk-border);
    background: var(--gk-bg);
    flex-shrink: 0;
  }

  .gk-header-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--gk-text);
    margin: 0;
  }

  .gk-header-status {
    font-size: 12px;
    color: var(--gk-text-secondary);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .gk-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #94a3b8;
    flex-shrink: 0;
  }

  .gk-status-dot[data-ready="true"] {
    background: #22c55e;
  }

  .gk-close-btn {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--gk-text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s ease, color 0.15s ease;
    outline: none;
    flex-shrink: 0;
  }

  .gk-close-btn:hover {
    background: var(--gk-bg-secondary);
    color: var(--gk-text);
  }

  .gk-close-btn:focus-visible {
    outline: 2px solid var(--gk-primary);
    outline-offset: -2px;
  }

  .gk-close-btn svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
  }

  /* ----- Transcript ----- */

  .gk-transcript {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    scroll-behavior: smooth;
  }

  .gk-transcript::-webkit-scrollbar {
    width: 4px;
  }

  .gk-transcript::-webkit-scrollbar-thumb {
    background: var(--gk-border);
    border-radius: 2px;
  }

  .gk-empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--gk-text-secondary);
    text-align: center;
    padding: 32px 16px;
  }

  .gk-empty-state-icon {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: var(--gk-bg-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 4px;
  }

  .gk-empty-state-icon svg {
    width: 20px;
    height: 20px;
    fill: var(--gk-text-secondary);
  }

  .gk-empty-state p {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
  }

  /* ----- Message Bubbles ----- */

  .gk-message {
    max-width: 85%;
    padding: 10px 14px;
    border-radius: 12px;
    font-size: 14px;
    line-height: 1.5;
    word-wrap: break-word;
    white-space: pre-wrap;
  }

  .gk-message[data-role="user"] {
    align-self: flex-end;
    background: var(--gk-primary);
    color: #fff;
    border-bottom-right-radius: 4px;
  }

  .gk-message[data-role="assistant"] {
    align-self: flex-start;
    background: var(--gk-bg-secondary);
    color: var(--gk-text);
    border-bottom-left-radius: 4px;
  }

  /* ----- Processing indicator ----- */

  .gk-processing {
    align-self: flex-start;
    display: flex;
    gap: 4px;
    padding: 12px 16px;
  }

  .gk-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--gk-text-secondary);
    animation: gk-bounce 1.4s ease-in-out infinite;
  }

  .gk-dot:nth-child(2) { animation-delay: 0.16s; }
  .gk-dot:nth-child(3) { animation-delay: 0.32s; }

  @keyframes gk-bounce {
    0%, 80%, 100% { transform: translateY(0); }
    40% { transform: translateY(-6px); }
  }

  /* ----- Input Area ----- */

  .gk-input-area {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--gk-border);
    background: var(--gk-bg);
    flex-shrink: 0;
  }

  .gk-input {
    flex: 1;
    min-height: 40px;
    max-height: 120px;
    padding: 8px 14px;
    border: 1px solid var(--gk-border);
    border-radius: 12px;
    background: var(--gk-bg);
    color: var(--gk-text);
    font-family: var(--gk-font);
    font-size: 14px;
    line-height: 1.5;
    resize: none;
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .gk-input::placeholder {
    color: var(--gk-text-secondary);
  }

  .gk-input:focus {
    border-color: var(--gk-primary);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
  }

  .gk-send-btn {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    border: none;
    background: var(--gk-primary);
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s ease, transform 0.1s ease;
    outline: none;
  }

  .gk-send-btn:hover:not(:disabled) {
    background: var(--gk-primary-hover);
  }

  .gk-send-btn:active:not(:disabled) {
    transform: scale(0.93);
  }

  .gk-send-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .gk-send-btn:focus-visible {
    outline: 2px solid var(--gk-primary);
    outline-offset: 3px;
  }

  .gk-send-btn svg {
    width: 18px;
    height: 18px;
    fill: currentColor;
  }

  /* ----- Mic Button ----- */

  .gk-mic-btn {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    border: none;
    background: transparent;
    color: var(--gk-text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
    outline: none;
  }

  .gk-mic-btn:hover:not(:disabled) {
    background: var(--gk-bg-secondary);
    color: var(--gk-text);
  }

  .gk-mic-btn:active:not(:disabled) {
    transform: scale(0.93);
  }

  .gk-mic-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .gk-mic-btn:focus-visible {
    outline: 2px solid var(--gk-primary);
    outline-offset: 3px;
  }

  .gk-mic-btn svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
  }

  .gk-mic-btn[data-active="true"] {
    background: #fee2e2;
    color: #dc2626;
  }

  .gk-mic-btn[data-active="true"]:hover {
    background: #fecaca;
  }

  /* Pulse animation for active mic */
  @keyframes gk-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.4); }
    50% { box-shadow: 0 0 0 6px rgba(220, 38, 38, 0); }
  }

  .gk-mic-btn[data-active="true"] {
    animation: gk-pulse 1.5s ease-in-out infinite;
  }

  /* ----- Voice Degraded Banner ----- */

  .gk-voice-notice {
    padding: 6px 16px;
    background: #fffbeb;
    color: #92400e;
    font-size: 12px;
    line-height: 1.4;
    border-top: 1px solid #fde68a;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* ----- Error Banner ----- */

  .gk-error {
    padding: 8px 16px;
    background: #fef2f2;
    color: #dc2626;
    font-size: 12px;
    line-height: 1.4;
    border-top: 1px solid #fecaca;
    flex-shrink: 0;
  }

  /* ----- Mobile Responsive: Bottom Sheet ----- */

  @media (hover: none) and (pointer: coarse), (max-width: 768px) {
    :host {
      bottom: 16px !important;
      right: 16px !important;
      left: auto !important;
    }

    .gk-panel {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      width: 100%;
      height: 70vh;
      max-height: 70vh;
      border-radius: var(--gk-radius) var(--gk-radius) 0 0;
      transform: translateY(100%);
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }

    .gk-panel[data-open="true"] {
      transform: translateY(0);
    }

    .gk-fab {
      bottom: 16px;
      right: 16px;
    }

    .gk-input-area {
      padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    }

    /* Touch targets min 44x44 */
    .gk-send-btn,
    .gk-mic-btn,
    .gk-close-btn {
      min-width: 44px;
      min-height: 44px;
    }
  }

  /* ----- Privacy Consent Dialog ----- */

  .gk-consent-dialog {
    position: absolute;
    bottom: calc(var(--gk-fab-size) + 16px);
    right: 0;
    width: var(--gk-panel-width);
    background: var(--gk-bg);
    border-radius: var(--gk-radius);
    box-shadow: var(--gk-shadow);
    padding: 24px;
    opacity: 0;
    transform: translateY(12px) scale(0.95);
    pointer-events: none;
    transition: opacity 0.2s ease, transform 0.2s ease;
  }

  .gk-consent-dialog[data-open="true"] {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }

  .gk-consent-message {
    font-size: 14px;
    line-height: 1.6;
    color: var(--gk-text);
    margin: 0 0 20px 0;
  }

  .gk-consent-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  .gk-consent-btn {
    padding: 8px 20px;
    border-radius: 10px;
    font-family: var(--gk-font);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease, transform 0.1s ease;
    outline: none;
    border: none;
  }

  .gk-consent-btn:focus-visible {
    outline: 2px solid var(--gk-primary);
    outline-offset: 2px;
  }

  .gk-consent-btn:active {
    transform: scale(0.97);
  }

  .gk-consent-btn--decline {
    background: var(--gk-bg-secondary);
    color: var(--gk-text-secondary);
    border: 1px solid var(--gk-border);
  }

  .gk-consent-btn--decline:hover {
    background: var(--gk-border);
    color: var(--gk-text);
  }

  .gk-consent-btn--accept {
    background: var(--gk-primary);
    color: #fff;
  }

  .gk-consent-btn--accept:hover {
    background: var(--gk-primary-hover);
  }

  /* ----- High Contrast (Windows) ----- */

  @media (forced-colors: active) {
    .gk-fab,
    .gk-send-btn,
    .gk-mic-btn {
      border: 2px solid ButtonText;
    }

    .gk-panel {
      border: 1px solid ButtonText;
    }

    .gk-message[data-role="user"] {
      border: 1px solid Highlight;
    }

    .gk-message[data-role="assistant"] {
      border: 1px solid ButtonText;
    }

    .gk-consent-dialog {
      border: 1px solid ButtonText;
    }

    .gk-consent-btn {
      border: 2px solid ButtonText;
    }
  }
`;

// ---------------------------------------------------------------------------
// SVG icons (inline, no external deps)
// ---------------------------------------------------------------------------

const ChatIcon = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z" />
    <path d="M7 9h10v2H7zm0-3h10v2H7z" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </svg>
);

const SendIcon = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
  </svg>
);

const MicIcon = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
  </svg>
);

const MicOffIcon = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
  </svg>
);

const SparkleIcon = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z" />
  </svg>
);

// ---------------------------------------------------------------------------
// GuideKitWidget (internal) — Shadow DOM isolated chat widget
// ---------------------------------------------------------------------------

interface WidgetProps {
  theme?: {
    primaryColor?: string;
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    borderRadius?: string;
  };
  consentRequired?: boolean;
  instanceId?: string;
}

function GuideKitWidget({ theme, consentRequired, instanceId }: WidgetProps) {
  const core = useGuideKitCore();
  const { isReady, agentState } = useGuideKitStatus();

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);

  // ---- Privacy consent state ----

  const consentStorageKey = `guidekit-consent:${instanceId ?? 'default'}`;

  const [hasConsent, setHasConsent] = useState<boolean>(() => {
    if (!consentRequired) return true;
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(consentStorageKey) === 'granted';
    } catch {
      return false;
    }
  });

  const [showConsentDialog, setShowConsentDialog] = useState(false);

  const shadowHostRef = useRef<HTMLDivElement | null>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);
  const shadowContainerRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fabRef = useRef<HTMLButtonElement | null>(null);

  // Monotonic ID counter for messages
  const msgIdRef = useRef(0);

  // i18n helper — get localized string from core
  const t = useCallback(
    (key: string): string => {
      if (core) {
        return (core.i18n as any).t(key) ?? key;
      }
      return key;
    },
    [core],
  );

  // Track whether Shadow DOM has been initialised
  const [shadowReady, setShadowReady] = useState(false);

  // ---- Create Shadow DOM on mount ----

  useEffect(() => {
    const host = shadowHostRef.current;
    if (!host || shadowRootRef.current) return;

    const shadow = host.attachShadow({ mode: 'open' });
    shadowRootRef.current = shadow;

    // Inject styles
    const styleEl = document.createElement('style');
    styleEl.textContent = WIDGET_STYLES;
    shadow.appendChild(styleEl);

    // Create a container div for React to portal into (we render imperatively)
    const container = document.createElement('div');
    shadow.appendChild(container);
    shadowContainerRef.current = container;
    setShadowReady(true);

    return () => {
      shadowRootRef.current = null;
      shadowContainerRef.current = null;
      setShadowReady(false);
    };
  }, []);

  // ---- Apply theme CSS custom properties ----

  useEffect(() => {
    const container = shadowContainerRef.current;
    if (!container) return;
    const host = shadowHostRef.current;
    if (!host) return;

    if (theme?.primaryColor) {
      host.style.setProperty('--gk-primary', theme.primaryColor);
    }
    if (theme?.borderRadius) {
      host.style.setProperty('--gk-radius', theme.borderRadius);
    }

    // Position
    const pos = theme?.position ?? 'bottom-right';
    host.style.removeProperty('top');
    host.style.removeProperty('bottom');
    host.style.removeProperty('left');
    host.style.removeProperty('right');

    switch (pos) {
      case 'bottom-right':
        host.style.bottom = '24px';
        host.style.right = '24px';
        break;
      case 'bottom-left':
        host.style.bottom = '24px';
        host.style.left = '24px';
        break;
      case 'top-right':
        host.style.top = '24px';
        host.style.right = '24px';
        break;
      case 'top-left':
        host.style.top = '24px';
        host.style.left = '24px';
        break;
    }
  }, [theme, shadowReady]);

  // ---- Auto-scroll transcript ----

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isSending]);

  // ---- Focus input when panel opens ----

  useEffect(() => {
    if (isOpen && inputRef.current) {
      // Small delay to let the panel animate in
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // ---- Send message handler ----

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || !core || isSending) return;

    const userMsg: TranscriptMessage = {
      id: `msg-${++msgIdRef.current}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsSending(true);

    try {
      const response = await core.sendText(text);
      const assistantMsg: TranscriptMessage = {
        id: `msg-${++msgIdRef.current}`,
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const errorContent =
        err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      const errorMsg: TranscriptMessage = {
        id: `msg-${++msgIdRef.current}`,
        role: 'assistant',
        content: `Error: ${errorContent}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsSending(false);
    }
  }, [inputValue, core, isSending]);

  // ---- Mic toggle handler ----

  const handleMicToggle = useCallback(async () => {
    if (!core) return;

    if (isVoiceActive) {
      core.stopListening();
      setIsVoiceActive(false);
    } else {
      try {
        await core.startListening();
        setIsVoiceActive(true);
      } catch (err) {
        console.error('[GuideKit] Failed to start voice:', err);
        setIsVoiceActive(false);
      }
    }
  }, [core, isVoiceActive]);

  // ---- Keyboard handlers ----

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
        // Return focus to FAB
        fabRef.current?.focus();
      }
    },
    [handleSend],
  );

  const handlePanelKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        fabRef.current?.focus();
      }
    },
    [],
  );

  // ---- Consent handlers ----

  const handleConsentAccept = useCallback(() => {
    try {
      localStorage.setItem(consentStorageKey, 'granted');
    } catch {
      // localStorage may be unavailable (e.g. private browsing quota)
    }
    setHasConsent(true);
    setShowConsentDialog(false);
    setIsOpen(true);
  }, [consentStorageKey]);

  const handleConsentDecline = useCallback(() => {
    setShowConsentDialog(false);
    fabRef.current?.focus();
  }, []);

  const handleConsentKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        setShowConsentDialog(false);
        fabRef.current?.focus();
      }
    },
    [],
  );

  // ---- Toggle panel ----

  const togglePanel = useCallback(() => {
    if (consentRequired && !hasConsent) {
      // First click: show consent dialog instead of opening the panel
      setShowConsentDialog((prev) => !prev);
      return;
    }
    setIsOpen((prev) => !prev);
  }, [consentRequired, hasConsent]);

  // ---- Determine processing state ----

  const isProcessing = agentState.status === 'processing';
  const hasVoice = core?.hasVoice ?? false;
  const isListeningState = agentState.status === 'listening';
  const isSpeakingState = agentState.status === 'speaking';

  // Sync voice active state with agent state
  useEffect(() => {
    if (!isListeningState && isVoiceActive) {
      // Voice state changed externally (e.g. barge-in ended listening)
      // Don't clear if speaking - that's expected in half-duplex
      if (!isSpeakingState && !isProcessing) {
        setIsVoiceActive(false);
      }
    }
  }, [isListeningState, isSpeakingState, isProcessing, isVoiceActive]);

  // ---- Derive status label ----

  const statusLabel = isReady
    ? isListeningState
      ? t('statusListening')
      : isSpeakingState
        ? t('statusSpeaking')
        : t('statusOnline')
    : t('statusConnecting');

  // ---- Render into Shadow DOM imperatively via portal ----

  // We cannot use ReactDOM.createPortal into a shadow root container directly
  // in all React versions. Instead we render the widget tree *outside* the
  // Shadow DOM host element and use an effect to clone/sync it in. However,
  // the simplest cross-version approach is to render the UI in the normal
  // React tree and use the shadow host purely for style encapsulation.
  //
  // For maximum compatibility we render our widget markup below and portal
  // it into the shadow container using ReactDOM.createPortal when shadow is
  // ready.

  // We need dynamic import of createPortal to avoid SSR issues.
  const createPortalRef = useRef<typeof import('react-dom').createPortal | null>(null);
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    import('react-dom').then((mod) => {
      createPortalRef.current = mod.createPortal;
      setPortalReady(true);
    });
  }, []);

  // ---- Widget UI tree ----

  const widgetUI = (
    <>
      {/* Panel */}
      <div
        className="gk-panel"
        data-open={isOpen ? 'true' : 'false'}
        role="dialog"
        aria-label={t('widgetTitle')}
        aria-hidden={!isOpen}
        onKeyDown={handlePanelKeyDown}
      >
        {/* Header */}
        <div className="gk-header">
          <div>
            <div className="gk-header-title">{t('widgetTitle')}</div>
            <div className="gk-header-status">
              <span className="gk-status-dot" data-ready={isReady ? 'true' : 'false'} />
              <span>{statusLabel}</span>
            </div>
          </div>
          <button
            className="gk-close-btn"
            onClick={() => {
              setIsOpen(false);
              fabRef.current?.focus();
            }}
            aria-label={t('closePanel')}
            tabIndex={isOpen ? 0 : -1}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Transcript */}
        <div
          className="gk-transcript"
          ref={transcriptRef}
          role="log"
          aria-live="polite"
          aria-label="Conversation transcript"
        >
          {messages.length === 0 && !isSending ? (
            <div className="gk-empty-state">
              <div className="gk-empty-state-icon">
                <SparkleIcon />
              </div>
              <p>{t('emptyStateMessage')}</p>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className="gk-message"
                  data-role={msg.role}
                  role={msg.role === 'assistant' ? 'status' : undefined}
                >
                  {msg.content}
                </div>
              ))}
              {isProcessing && (
                <div className="gk-processing" role="status" aria-label="Processing">
                  <div className="gk-dot" />
                  <div className="gk-dot" />
                  <div className="gk-dot" />
                </div>
              )}
            </>
          )}
        </div>

        {/* Error banner */}
        {agentState.status === 'error' && (
          <div className="gk-error" role="alert">
            {agentState.error?.message ?? 'An error occurred.'}
          </div>
        )}

        {/* Input area */}
        <div className="gk-input-area">
          {hasVoice && (
            <button
              className="gk-mic-btn"
              onClick={handleMicToggle}
              disabled={!isReady || isSending}
              data-active={isVoiceActive || isListeningState ? 'true' : 'false'}
              aria-label={isVoiceActive ? t('stopVoice') : t('startVoice')}
              tabIndex={isOpen ? 0 : -1}
            >
              {isVoiceActive || isListeningState ? <MicOffIcon /> : <MicIcon />}
            </button>
          )}
          <textarea
            className="gk-input"
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isListeningState ? t('listeningPlaceholder') : t('inputPlaceholder')}
            aria-label={t('sendMessage')}
            rows={1}
            disabled={!isReady || isSending}
            tabIndex={isOpen ? 0 : -1}
          />
          <button
            className="gk-send-btn"
            onClick={handleSend}
            disabled={!isReady || isSending || !inputValue.trim()}
            aria-label={t('sendMessage')}
            tabIndex={isOpen ? 0 : -1}
          >
            <SendIcon />
          </button>
        </div>
      </div>

      {/* Privacy Consent Dialog */}
      {consentRequired && !hasConsent && (
        <div
          className="gk-consent-dialog"
          data-open={showConsentDialog ? 'true' : 'false'}
          role="dialog"
          aria-label="Privacy consent"
          aria-hidden={!showConsentDialog}
          onKeyDown={handleConsentKeyDown}
        >
          <p className="gk-consent-message">
            This assistant uses AI to help you navigate this site. Your questions will be processed by an AI service.
          </p>
          <div className="gk-consent-actions">
            <button
              className="gk-consent-btn gk-consent-btn--decline"
              onClick={handleConsentDecline}
              tabIndex={showConsentDialog ? 0 : -1}
            >
              Decline
            </button>
            <button
              className="gk-consent-btn gk-consent-btn--accept"
              onClick={handleConsentAccept}
              tabIndex={showConsentDialog ? 0 : -1}
            >
              Accept
            </button>
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        className="gk-fab"
        ref={fabRef}
        onClick={togglePanel}
        aria-label={isOpen ? t('closeAssistant') : t('openAssistant')}
        aria-expanded={isOpen || showConsentDialog}
        aria-haspopup="dialog"
      >
        {isOpen ? <CloseIcon /> : <ChatIcon />}
      </button>
    </>
  );

  // ---- SSR guard: render nothing on the server ----

  if (typeof window === 'undefined') {
    return null;
  }

  return (
    <div
      ref={shadowHostRef}
      id="guidekit-widget"
      style={{
        // The host element itself is positioned via :host in Shadow DOM CSS,
        // but we also set fixed positioning here as a fallback.
        position: 'fixed',
        zIndex: 2147483647,
        bottom: '24px',
        right: '24px',
        // Ensure the host doesn't interfere with page layout
        margin: 0,
        padding: 0,
        border: 'none',
        background: 'none',
      }}
    >
      {shadowReady && portalReady && shadowContainerRef.current && createPortalRef.current
        ? createPortalRef.current(widgetUI, shadowContainerRef.current)
        : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export type {
  GuideKitCoreOptions,
  GuideKitProviderProps,
  AgentState,
  GuideKitStore,
  GuideKitErrorType,
  GuideKitEvent,
};
