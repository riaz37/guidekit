import { GuideKitCore } from '@guidekit/core';
import type {
  GuideKitCoreOptions,
  GuideKitProviderProps,
  GuideKitErrorType,
} from '@guidekit/core';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { GuideKitContext } from './_context.js';
import { GuideKitWidget } from './widget/index.js';

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
    proxy,
    intelligence,
    knowledge,
    plugins,
    hallucinationGuard,
    cognitive,
    headless = false,
    navigation,
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
      proxy,
      intelligence,
      knowledge,
      plugins,
      hallucinationGuard,
      cognitive,
      navigation,
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
      {!headless && (
        <GuideKitWidget
          theme={theme}
          consentRequired={options?.consentRequired}
          instanceId={instanceId}
        />
      )}
    </GuideKitContext.Provider>
  );
}
