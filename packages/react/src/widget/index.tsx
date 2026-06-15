import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useGuideKitCore, useGuideKitStatus, useGuideKitStream, useGuideKitConsent } from '../hooks/index.js';
import { WIDGET_STYLES } from './styles.js';
import type { TranscriptMessage, WidgetProps } from './types.js';

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
// GuideKitWidget — Shadow DOM isolated chat widget
// ---------------------------------------------------------------------------

export function GuideKitWidget({ theme, consentRequired, instanceId }: WidgetProps) {
  const core = useGuideKitCore();
  const { isReady, agentState } = useGuideKitStatus();
  const { isStreaming, streamingText } = useGuideKitStream();

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);

  // ---- Privacy consent state ----

  const { hasConsent, grantConsent } = useGuideKitConsent({ consentRequired, instanceId });

  const [showConsentDialog, setShowConsentDialog] = useState(false);

  const shadowHostRef = useRef<HTMLDivElement | null>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);
  const shadowContainerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fabRef = useRef<HTMLButtonElement | null>(null);

  // Monotonic ID counter for messages
  const msgIdRef = useRef(0);
  const voiceUserMsgIdRef = useRef<string | null>(null);
  const voiceAssistantMsgIdRef = useRef<string | null>(null);
  const lastVoiceStreamTextRef = useRef('');

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

    if (host.shadowRoot) { shadowRootRef.current = host.shadowRoot; return; }

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
    if (theme?.zIndex !== undefined) {
      host.style.setProperty('--gk-z-index', String(theme.zIndex));
    } else {
      host.style.removeProperty('--gk-z-index');
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

  // ---- Voice transcript → chat messages ----

  useEffect(() => {
    if (!core) return;

    const unsub = core.bus.on('voice:transcript', ({ text, isFinal }) => {
      if (!text.trim()) return;

      const msgId = voiceUserMsgIdRef.current ?? `msg-${++msgIdRef.current}`;
      if (isFinal) {
        voiceUserMsgIdRef.current = null;
      } else {
        voiceUserMsgIdRef.current = msgId;
      }

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === msgId);
        const userMsg: TranscriptMessage = {
          id: msgId,
          role: 'user',
          content: text,
          timestamp: Date.now(),
        };
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = userMsg;
          return next;
        }
        return [...prev, userMsg];
      });

      if (!isFinal) return;

      const assistantId = `msg-${++msgIdRef.current}`;
      voiceAssistantMsgIdRef.current = assistantId;
      lastVoiceStreamTextRef.current = '';
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
        },
      ]);
      setIsSending(true);
    });

    return unsub;
  }, [core]);

  // ---- Mirror voice LLM stream into the assistant bubble ----

  useEffect(() => {
    const assistantId = voiceAssistantMsgIdRef.current;
    if (!assistantId) return;

    if (streamingText) {
      lastVoiceStreamTextRef.current = streamingText;
    }

    if (isStreaming) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: streamingText } : m,
        ),
      );
      return;
    }

    const finalText = lastVoiceStreamTextRef.current;
    if (finalText) {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: finalText } : m)),
      );
    }
    lastVoiceStreamTextRef.current = '';
    voiceAssistantMsgIdRef.current = null;
    setIsSending(false);
  }, [isStreaming, streamingText]);

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
      // Create empty assistant message immediately
      const assistantMsgId = `msg-${++msgIdRef.current}`;
      const assistantMsg: TranscriptMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Stream tokens into the message; apply post-pipeline fullText (e.g. plugin hooks).
      const { stream, done } = core.sendTextStream(text);
      for await (const chunk of stream) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: m.content + chunk }
              : m,
          ),
        );
      }
      const result = await done;
      if (result.fullText) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: result.fullText } : m,
          ),
        );
      }
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
        const message =
          err instanceof Error ? err.message : 'Voice input is unavailable in this browser.';
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${++msgIdRef.current}`,
            role: 'assistant',
            content: message,
            timestamp: Date.now(),
          },
        ]);
      }
    }
  }, [core, isVoiceActive]);

  const closePanel = useCallback(() => {
    setIsOpen(false);
    fabRef.current?.focus();
  }, []);

  // ---- Keyboard handlers ----

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === 'Escape') {
        closePanel();
      }
    },
    [closePanel, handleSend],
  );

  const handlePanelKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        closePanel();
      }
    },
    [closePanel],
  );

  // ---- Consent handlers ----

  const handleConsentAccept = useCallback(() => {
    grantConsent();
    setShowConsentDialog(false);
    setIsOpen(true);
  }, [grantConsent]);

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
      if (e.key === 'Tab') {
        const focusable = (e.currentTarget as HTMLElement).querySelectorAll('button');
        if (focusable.length === 0) return;
        const first = focusable[0] as HTMLElement;
        const last = focusable[focusable.length - 1] as HTMLElement;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
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
    if (isListeningState || isSpeakingState) {
      setIsVoiceActive(true);
      return;
    }
    if (!isProcessing && isVoiceActive) {
      setIsVoiceActive(false);
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

  useEffect(() => {
    const panelEl = panelRef.current;
    if (!panelEl) return;

    // Native listeners are more reliable than React's synthetic Shadow DOM
    // path in browser automation, especially for Escape-driven close actions.
    const handleNativePanelKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePanel();
      }
    };

    panelEl.addEventListener('keydown', handleNativePanelKeyDown);
    return () => {
      panelEl.removeEventListener('keydown', handleNativePanelKeyDown);
    };
  }, [closePanel]);

  // ---- Widget UI tree ----

  const widgetUI = (
    <>
      {/* Panel */}
      <div
        className="gk-panel"
        ref={panelRef}
        data-open={isOpen ? 'true' : 'false'}
        data-testid="guidekit-panel"
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
            onClick={closePanel}
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
          data-testid="guidekit-transcript"
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
              data-testid="guidekit-mic"
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
            data-testid="guidekit-input"
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
            data-testid="guidekit-send"
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
        data-testid="guidekit-fab"
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
      role="complementary"
      aria-label={t('widgetTitle')}
      style={{
        // The host element itself is positioned via :host in Shadow DOM CSS,
        // but we also set fixed positioning here as a fallback.
        position: 'fixed',
        zIndex: theme?.zIndex ?? 2147483647,
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
