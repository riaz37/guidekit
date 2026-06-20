export const WIDGET_STYLES = /* css */ `
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
    z-index: var(--gk-z-index, 2147483647);
    bottom: 24px;
    right: 24px;
    pointer-events: none;
  }

  .gk-mount {
    position: relative;
    width: 100%;
    height: 100%;
    pointer-events: none;
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
    pointer-events: auto;
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
