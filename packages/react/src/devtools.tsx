// ---------------------------------------------------------------------------
// @guidekit/react/devtools — Development-only DevTools panel
// ---------------------------------------------------------------------------
//
// A collapsible, fixed-position panel that surfaces internal SDK state for
// debugging: agent state, live event log, discovered page sections, and
// rate-limiter counters.
//
// Usage:
//   import { GuideKitDevTools } from '@guidekit/react/devtools';
//   <GuideKitProvider ...>
//     <App />
//     {process.env.NODE_ENV === 'development' && <GuideKitDevTools />}
//   </GuideKitProvider>
// ---------------------------------------------------------------------------

import {
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useSyncExternalStore,
} from 'react';
import type { GuideKitCore } from '@guidekit/core';
import type { RateLimiterState, PageSection } from '@guidekit/core';

import { GuideKitContext } from './_context.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = 'state' | 'events' | 'sections' | 'ratelimits';

interface EventLogEntry {
  id: number;
  timestamp: number;
  name: string;
  data: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_EVENT_LOG = 200;

const TAB_LABELS: Record<TabId, string> = {
  state: 'State',
  events: 'Events',
  sections: 'Sections',
  ratelimits: 'Rate Limits',
};

const TAB_ORDER: TabId[] = ['state', 'events', 'sections', 'ratelimits'];

// ---------------------------------------------------------------------------
// Styles (inline — devtools live outside Shadow DOM)
// ---------------------------------------------------------------------------

const S = {
  container: {
    position: 'fixed' as const,
    top: 24,
    right: 24,
    zIndex: 2147483646,
    fontFamily:
      "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
    fontSize: 12,
    lineHeight: 1.5,
    color: '#e2e8f0',
    pointerEvents: 'auto' as const,
  },

  toggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    border: '1px solid #334155',
    borderRadius: 8,
    background: '#1e293b',
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap' as const,
  },

  panel: {
    width: 420,
    maxHeight: 520,
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: 10,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  },

  titleBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    background: '#1e293b',
    borderBottom: '1px solid #334155',
    flexShrink: 0,
  },

  titleText: {
    fontWeight: 700,
    fontSize: 12,
    color: '#e2e8f0',
    margin: 0,
  },

  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#64748b',
    cursor: 'pointer',
    fontSize: 16,
    lineHeight: 1,
    padding: '0 4px',
    fontFamily: 'inherit',
  },

  tabBar: {
    display: 'flex',
    borderBottom: '1px solid #334155',
    background: '#1e293b',
    flexShrink: 0,
  },

  tab: (active: boolean) => ({
    flex: 1,
    padding: '6px 8px',
    background: active ? '#0f172a' : 'transparent',
    color: active ? '#e2e8f0' : '#64748b',
    border: 'none',
    borderBottom: active ? '2px solid #6366f1' : '2px solid transparent',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
    fontWeight: active ? 600 : 400,
    transition: 'color 0.15s, background 0.15s',
  }),

  tabContent: {
    flex: 1,
    overflow: 'auto',
    padding: 12,
    minHeight: 200,
    maxHeight: 400,
  },

  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 0',
    borderBottom: '1px solid #1e293b',
  },

  label: {
    color: '#94a3b8',
    fontSize: 11,
  },

  value: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: 600,
  },

  badge: (color: string) => ({
    display: 'inline-block',
    padding: '1px 6px',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    background: color,
    color: '#fff',
  }),

  eventRow: {
    padding: '3px 0',
    borderBottom: '1px solid #1e293b',
    wordBreak: 'break-all' as const,
  },

  eventTime: {
    color: '#475569',
    fontSize: 10,
    marginRight: 6,
  },

  eventName: {
    color: '#818cf8',
    fontSize: 11,
    fontWeight: 600,
  },

  eventData: {
    color: '#64748b',
    fontSize: 10,
    marginLeft: 4,
    display: 'block',
    whiteSpace: 'pre-wrap' as const,
    maxHeight: 60,
    overflow: 'hidden',
  },

  sectionRow: {
    padding: '4px 0',
    borderBottom: '1px solid #1e293b',
  },

  sectionId: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: 600,
  },

  sectionMeta: {
    color: '#64748b',
    fontSize: 10,
    display: 'flex',
    gap: 8,
    marginTop: 2,
  },

  meter: {
    height: 6,
    borderRadius: 3,
    background: '#1e293b',
    overflow: 'hidden',
    marginTop: 4,
  },

  meterFill: (pct: number, color: string) => ({
    height: '100%',
    width: `${Math.min(pct, 100)}%`,
    background: color,
    borderRadius: 3,
    transition: 'width 0.3s ease',
  }),

  emptyState: {
    color: '#475569',
    textAlign: 'center' as const,
    padding: '24px 0',
    fontSize: 11,
  },

  clearBtn: {
    background: '#1e293b',
    border: '1px solid #334155',
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: 10,
    padding: '2px 8px',
    borderRadius: 4,
    fontFamily: 'inherit',
  },
} as const;

// ---------------------------------------------------------------------------
// Status badge color helper
// ---------------------------------------------------------------------------

function statusColor(status: string): string {
  switch (status) {
    case 'idle':
      return '#475569';
    case 'listening':
      return '#22c55e';
    case 'processing':
      return '#f59e0b';
    case 'speaking':
      return '#6366f1';
    case 'error':
      return '#ef4444';
    default:
      return '#475569';
  }
}

// ---------------------------------------------------------------------------
// Time formatter
// ---------------------------------------------------------------------------

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

// ---------------------------------------------------------------------------
// Truncated JSON renderer
// ---------------------------------------------------------------------------

function truncateJSON(data: unknown, maxLen = 120): string {
  try {
    const json = JSON.stringify(data);
    if (json.length > maxLen) return json.slice(0, maxLen) + '...';
    return json;
  } catch {
    return String(data);
  }
}

// ---------------------------------------------------------------------------
// Tab: State
// ---------------------------------------------------------------------------

function StateTab({ core }: { core: GuideKitCore }) {
  const subscribe = useCallback(
    (listener: () => void) => core.subscribe(listener),
    [core],
  );
  const getSnapshot = useCallback(() => core.getSnapshot(), [core]);
  const store = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const agentStatus = store.status.agentState.status;
  const isReady = store.status.isReady;
  const isListening = store.voice.isListening;
  const isSpeaking = store.voice.isSpeaking;
  const hasVoice = core.hasVoice;
  const quietMode = core.quietMode;

  return (
    <div>
      <div style={S.row}>
        <span style={S.label}>isReady</span>
        <span
          style={S.badge(isReady ? '#22c55e' : '#ef4444')}
        >
          {isReady ? 'true' : 'false'}
        </span>
      </div>

      <div style={S.row}>
        <span style={S.label}>agentState</span>
        <span style={S.badge(statusColor(agentStatus))}>{agentStatus}</span>
      </div>

      <div style={S.row}>
        <span style={S.label}>isListening</span>
        <span style={S.value}>{String(isListening)}</span>
      </div>

      <div style={S.row}>
        <span style={S.label}>isSpeaking</span>
        <span style={S.value}>{String(isSpeaking)}</span>
      </div>

      <div style={S.row}>
        <span style={S.label}>hasVoice</span>
        <span style={S.value}>{String(hasVoice)}</span>
      </div>

      <div style={S.row}>
        <span style={S.label}>quietMode</span>
        <span
          style={S.badge(quietMode ? '#f59e0b' : '#475569')}
        >
          {quietMode ? 'on' : 'off'}
        </span>
      </div>

      {store.status.error && (
        <div style={{ marginTop: 8 }}>
          <div style={{ ...S.label, marginBottom: 4 }}>Error</div>
          <div
            style={{
              background: '#1e293b',
              padding: 8,
              borderRadius: 6,
              color: '#fca5a5',
              fontSize: 10,
              whiteSpace: 'pre-wrap',
              maxHeight: 80,
              overflow: 'auto',
            }}
          >
            {store.status.error.message}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Events
// ---------------------------------------------------------------------------

function EventsTab({ core }: { core: GuideKitCore }) {
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const unsub = core.bus.onAny((data, eventName) => {
      setEvents((prev) => {
        const next = [
          ...prev,
          {
            id: ++idRef.current,
            timestamp: Date.now(),
            name: eventName,
            data,
          },
        ];
        if (next.length > MAX_EVENT_LOG) {
          return next.slice(next.length - MAX_EVENT_LOG);
        }
        return next;
      });
    });
    return unsub;
  }, [core]);

  // Auto-scroll to bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [events.length]);

  const handleClear = useCallback(() => {
    setEvents([]);
    idRef.current = 0;
  }, []);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <span style={S.label}>{events.length} events</span>
        <button style={S.clearBtn} onClick={handleClear}>
          Clear
        </button>
      </div>

      <div
        ref={scrollRef}
        style={{ maxHeight: 340, overflow: 'auto' }}
      >
        {events.length === 0 ? (
          <div style={S.emptyState}>No events yet.</div>
        ) : (
          events.map((evt) => (
            <div key={evt.id} style={S.eventRow}>
              <span style={S.eventTime}>{formatTime(evt.timestamp)}</span>
              <span style={S.eventName}>{evt.name}</span>
              <span style={S.eventData}>{truncateJSON(evt.data)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Sections
// ---------------------------------------------------------------------------

function SectionsTab({ core }: { core: GuideKitCore }) {
  const [sections, setSections] = useState<PageSection[]>([]);

  // Re-read pageModel whenever the store notifies
  const subscribe = useCallback(
    (listener: () => void) => core.subscribe(listener),
    [core],
  );
  const getSnapshot = useCallback(
    () => core.pageModel?.sections ?? [],
    [core],
  );
  const liveSections = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Also listen for dom:scan-complete to catch page model refreshes
  useEffect(() => {
    setSections(liveSections);
  }, [liveSections]);

  useEffect(() => {
    const unsub = core.bus.on('dom:scan-complete', () => {
      setSections(core.pageModel?.sections ?? []);
    });
    return unsub;
  }, [core]);

  if (sections.length === 0) {
    return <div style={S.emptyState}>No sections discovered.</div>;
  }

  return (
    <div>
      <div style={{ ...S.label, marginBottom: 8 }}>
        {sections.length} section{sections.length !== 1 ? 's' : ''}
      </div>
      {sections.map((sec) => (
        <div key={sec.id} style={S.sectionRow}>
          <div style={S.sectionId}>{sec.id}</div>
          {sec.label && (
            <div style={{ color: '#cbd5e1', fontSize: 11 }}>{sec.label}</div>
          )}
          <div style={S.sectionMeta}>
            <span>score: {sec.score}</span>
            <span>
              visible:{' '}
              <span
                style={{
                  color: sec.isVisible ? '#22c55e' : '#ef4444',
                  fontWeight: 600,
                }}
              >
                {sec.isVisible ? 'yes' : 'no'}
              </span>
            </span>
            <span>
              ratio: {Math.round(sec.visibilityRatio * 100)}%
            </span>
            <span>depth: {sec.depth}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Rate Limits
// ---------------------------------------------------------------------------

function RateLimitsTab({ core }: { core: GuideKitCore }) {
  const [rlState, setRlState] = useState<RateLimiterState>(
    core.rateLimiterState,
  );

  // Refresh every second to keep the display live
  useEffect(() => {
    const id = setInterval(() => {
      setRlState(core.rateLimiterState);
    }, 1000);
    return () => clearInterval(id);
  }, [core]);

  // Default limits for percentage calculations
  const maxLLM = 10;
  const maxSTT = 60;
  const maxTTS = 50_000;

  const llmPct = (rlState.llmCallsInWindow / maxLLM) * 100;
  const sttPct = (rlState.sttMinutesUsed / maxSTT) * 100;
  const ttsPct = (rlState.ttsCharsUsed / maxTTS) * 100;

  const meterColor = (pct: number) =>
    pct >= 90 ? '#ef4444' : pct >= 60 ? '#f59e0b' : '#22c55e';

  return (
    <div>
      {/* LLM calls */}
      <div style={{ marginBottom: 12 }}>
        <div style={S.row}>
          <span style={S.label}>LLM calls (1 min window)</span>
          <span style={S.value}>
            {rlState.llmCallsInWindow} / {maxLLM}
          </span>
        </div>
        <div style={S.meter}>
          <div style={S.meterFill(llmPct, meterColor(llmPct))} />
        </div>
      </div>

      {/* STT minutes */}
      <div style={{ marginBottom: 12 }}>
        <div style={S.row}>
          <span style={S.label}>STT minutes (session)</span>
          <span style={S.value}>
            {rlState.sttMinutesUsed.toFixed(2)} / {maxSTT}
          </span>
        </div>
        <div style={S.meter}>
          <div style={S.meterFill(sttPct, meterColor(sttPct))} />
        </div>
      </div>

      {/* TTS characters */}
      <div style={{ marginBottom: 12 }}>
        <div style={S.row}>
          <span style={S.label}>TTS chars (session)</span>
          <span style={S.value}>
            {rlState.ttsCharsUsed.toLocaleString()} / {maxTTS.toLocaleString()}
          </span>
        </div>
        <div style={S.meter}>
          <div style={S.meterFill(ttsPct, meterColor(ttsPct))} />
        </div>
      </div>

      <div
        style={{
          ...S.label,
          fontSize: 10,
          marginTop: 8,
          color: '#475569',
        }}
      >
        Window started:{' '}
        {rlState.llmWindowStart
          ? formatTime(rlState.llmWindowStart)
          : 'N/A'}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component: GuideKitDevTools
// ---------------------------------------------------------------------------

export interface GuideKitDevToolsProps {
  /** Pass a GuideKitCore instance directly. If omitted, reads from context. */
  core?: GuideKitCore;
}

export function GuideKitDevTools(props?: GuideKitDevToolsProps) {
  // SSR guard
  if (typeof window === 'undefined') {
    return null;
  }

  return <DevToolsInner core={props?.core} />;
}

/**
 * Inner component separated so that the SSR guard at the top level is a
 * plain null return without hooks (avoids React hooks-after-early-return
 * warnings).
 */
function DevToolsInner({ core: coreProp }: { core?: GuideKitCore }) {
  const contextCore = useContext(GuideKitContext);
  const core = coreProp ?? contextCore;

  const [collapsed, setCollapsed] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('state');

  if (!core) {
    return (
      <div style={S.container}>
        <div style={S.toggle}>
          <span style={{ color: '#ef4444', fontWeight: 600 }}>
            GuideKit DevTools: no core instance found
          </span>
        </div>
      </div>
    );
  }

  if (collapsed) {
    return (
      <div style={S.container}>
        <button
          style={S.toggle}
          onClick={() => setCollapsed(false)}
          title="Open GuideKit DevTools"
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#6366f1',
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
          GuideKit DevTools
        </button>
      </div>
    );
  }

  return (
    <div style={S.container}>
      <div style={S.panel}>
        {/* Title bar */}
        <div style={S.titleBar}>
          <span style={S.titleText}>GuideKit DevTools</span>
          <button
            style={S.closeBtn}
            onClick={() => setCollapsed(true)}
            title="Close"
          >
            x
          </button>
        </div>

        {/* Tab bar */}
        <div style={S.tabBar}>
          {TAB_ORDER.map((id) => (
            <button
              key={id}
              style={S.tab(activeTab === id)}
              onClick={() => setActiveTab(id)}
            >
              {TAB_LABELS[id]}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={S.tabContent}>
          {activeTab === 'state' && <StateTab core={core} />}
          {activeTab === 'events' && <EventsTab core={core} />}
          {activeTab === 'sections' && <SectionsTab core={core} />}
          {activeTab === 'ratelimits' && <RateLimitsTab core={core} />}
        </div>
      </div>
    </div>
  );
}
