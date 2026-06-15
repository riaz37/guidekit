'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useGuideKitCore,
  useGuideKitStatus,
  useGuideKitStream,
} from '@guidekit/react';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

/**
 * Reference headless UI — bottom-left floating assistant built with hooks.
 * Used by /headless demo route and contract E2E.
 */
export function GuideKitCustomUi() {
  const core = useGuideKitCore();
  const { isReady } = useGuideKitStatus();
  const { isStreaming } = useGuideKitStream();

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const msgIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || !core || isSending) return;

    const userMsg: ChatMessage = {
      id: `msg-${++msgIdRef.current}`,
      role: 'user',
      content: text,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsSending(true);

    const assistantMsgId = `msg-${++msgIdRef.current}`;
    setMessages((prev) => [
      ...prev,
      { id: assistantMsgId, role: 'assistant', content: '' },
    ]);

    try {
      const { stream, done } = core.sendTextStream(text);
      for await (const chunk of stream) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: m.content + chunk } : m,
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
      const message =
        err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId ? { ...m, content: `Error: ${message}` } : m,
        ),
      );
    } finally {
      setIsSending(false);
    }
  }, [core, inputValue, isSending]);

  return (
    <>
      {isOpen && (
        <div
          data-testid="guidekit-custom-panel"
          role="dialog"
          aria-label="Custom GuideKit assistant"
          style={{
            position: 'fixed',
            top: 88,
            left: 24,
            width: 360,
            maxHeight: 480,
            display: 'flex',
            flexDirection: 'column',
            background: '#0f172a',
            color: '#f8fafc',
            borderRadius: 16,
            boxShadow: '0 12px 40px rgba(15, 23, 42, 0.35)',
            zIndex: 2147483646,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid rgba(148, 163, 184, 0.25)',
              fontWeight: 600,
            }}
          >
            Custom assistant
          </div>
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {messages.length === 0 ? (
              <p style={{ margin: 0, opacity: 0.7, fontSize: 14 }}>
                {isReady ? 'Ask anything about this page.' : 'Connecting…'}
              </p>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  data-testid={`guidekit-custom-message-${msg.role}`}
                  style={{
                    alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                    padding: '8px 12px',
                    borderRadius: 12,
                    background:
                      msg.role === 'user' ? '#2563eb' : 'rgba(148, 163, 184, 0.15)',
                    fontSize: 14,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {msg.content || (isStreaming && msg.role === 'assistant' ? '…' : '')}
                </div>
              ))
            )}
          </div>
          <div
            style={{
              display: 'flex',
              gap: 8,
              padding: 12,
              borderTop: '1px solid rgba(148, 163, 184, 0.25)',
            }}
          >
            <input
              ref={inputRef}
              data-testid="guidekit-custom-input"
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="Type a message…"
              disabled={!isReady || isSending}
              aria-label="Send message"
              style={{
                flex: 1,
                borderRadius: 8,
                border: '1px solid rgba(148, 163, 184, 0.35)',
                background: '#1e293b',
                color: '#f8fafc',
                padding: '8px 12px',
              }}
            />
            <button
              type="button"
              data-testid="guidekit-custom-send"
              onClick={() => void handleSend()}
              disabled={!isReady || isSending || !inputValue.trim()}
              aria-label="Send"
              style={{
                borderRadius: 8,
                border: 'none',
                background: '#2563eb',
                color: '#fff',
                padding: '8px 14px',
                cursor: 'pointer',
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        data-testid="guidekit-custom-fab"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={isOpen ? 'Close assistant' : 'Open assistant'}
        aria-expanded={isOpen}
        style={{
          position: 'fixed',
          top: 24,
          left: 24,
          width: 56,
          height: 56,
          borderRadius: '50%',
          border: 'none',
          background: '#2563eb',
          color: '#fff',
          fontSize: 24,
          cursor: 'pointer',
          boxShadow: '0 8px 24px rgba(37, 99, 235, 0.45)',
          zIndex: 2147483647,
        }}
      >
        {isOpen ? '×' : '✦'}
      </button>
    </>
  );
}
