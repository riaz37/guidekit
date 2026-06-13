export function useGuideKitCore(): GuideKitCore | null {
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

  const prevStatusRef = useRef(SSR_SNAPSHOT.status);
  const getSnapshot = useCallback(() => {
    if (!core) return SSR_SNAPSHOT.status;
    const next = core.getSnapshot().status;
    const prev = prevStatusRef.current;
    // Shallow compare to avoid unnecessary re-renders
    if (
      prev.isReady === next.isReady &&
      prev.agentState?.status === next.agentState?.status &&
      prev.error === next.error
    ) {
      return prev;
    }
    prevStatusRef.current = next;
    return next;
  }, [core]);

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
// Split Hook: useGuideKitStream
// ---------------------------------------------------------------------------

export function useGuideKitStream(): {
  isStreaming: boolean;
  streamingText: string;
  sendTextStream: (message: string) => { stream: AsyncIterable<string>; done: Promise<StreamResult> };
} {
  const core = useGuideKitCore();

  const subscribe = useCallback(
    (listener: () => void) =>
      core ? core.subscribe(listener) : SSR_SUBSCRIBE(listener),
    [core],
  );

  const getSnapshot = useCallback(
    () => (core ? core.getSnapshot().streaming ?? SSR_STREAMING : SSR_STREAMING),
    [core],
  );

  const streamingSlice = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => SSR_STREAMING,
  );

  const sendTextStream = useCallback(
    (message: string) => {
      if (!core) {
        throw new Error('GuideKit not initialised. Wrap your app in <GuideKitProvider>.');
      }
      return core.sendTextStream(message);
    },
    [core],
  );

  return {
    ...streamingSlice,
    sendTextStream,
  };
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
  isStreaming: boolean;
  streamingText: string;
  sendTextStream: (message: string) => { stream: AsyncIterable<string>; done: Promise<StreamResult> };
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
  const streaming = useGuideKitStream();

  return {
    ...status,
    ...voice,
    ...actions,
    ...ctx,
    ...streaming,
  };
}
