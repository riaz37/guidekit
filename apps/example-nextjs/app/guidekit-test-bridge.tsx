'use client';

import { useEffect } from 'react';
import { useGuideKitCore } from '@guidekit/react';
import type { KnowledgeDocument } from '@guidekit/core';

type BusEvent = { name: string; data: unknown; at: number };

declare global {
  interface Window {
    __guidekitTest?: {
      events: BusEvent[];
      waitForEvent: (name: string, timeoutMs?: number) => Promise<BusEvent>;
      waitForReady: (timeoutMs?: number) => Promise<void>;
      addKnowledgeDocument: (doc: KnowledgeDocument) => void;
      removeKnowledgeDocument: (documentId: string) => void;
      clear: () => void;
    };
  }
}

/**
 * Dev/E2E bridge: records EventBus emissions on window.__guidekitTest.
 * Only active when NODE_ENV === 'development'.
 */
export function GuideKitTestBridge() {
  const core = useGuideKitCore();

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || !core) return;

    const events: BusEvent[] = [];
    const waiters = new Map<
      string,
      Array<{ resolve: (e: BusEvent) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>
    >();

    const push = (name: string, data: unknown) => {
      const entry: BusEvent = { name, data, at: Date.now() };
      events.push(entry);
      const pending = waiters.get(name);
      if (pending?.length) {
        const next = pending.shift()!;
        clearTimeout(next.timer);
        next.resolve(entry);
        if (!pending.length) waiters.delete(name);
      }
    };

    const unsubValidation = core.bus.on('validation:complete', (data) => {
      push('validation:complete', data);
    });
    const unsubLlmEnd = core.bus.on('llm:response-end', (data) => {
      push('llm:response-end', data);
    });

    window.__guidekitTest = {
      events,
      waitForEvent: (name, timeoutMs = 30_000) =>
        new Promise<BusEvent>((resolve, reject) => {
          const existing = events.find((e) => e.name === name);
          if (existing) {
            resolve(existing);
            return;
          }
          const timer = setTimeout(() => {
            const list = waiters.get(name) ?? [];
            waiters.set(
              name,
              list.filter((w) => w.resolve !== resolve),
            );
            reject(new Error(`Timed out waiting for bus event: ${name}`));
          }, timeoutMs);
          const list = waiters.get(name) ?? [];
          list.push({ resolve, reject, timer });
          waiters.set(name, list);
        }),
      waitForReady: (timeoutMs = 30_000) =>
        new Promise<void>((resolve, reject) => {
          const start = Date.now();
          const timer = setInterval(() => {
            if (core.isReady) {
              clearInterval(timer);
              resolve();
              return;
            }
            if (Date.now() - start > timeoutMs) {
              clearInterval(timer);
              reject(new Error('Timed out waiting for GuideKitCore to become ready.'));
            }
          }, 50);
        }),
      addKnowledgeDocument: (doc) => {
        core.addKnowledgeDocument(doc);
      },
      removeKnowledgeDocument: (documentId) => {
        core.removeKnowledgeDocument(documentId);
      },
      clear: () => {
        events.length = 0;
      },
    };

    return () => {
      unsubValidation();
      unsubLlmEnd();
      delete window.__guidekitTest;
    };
  }, [core]);

  return null;
}
