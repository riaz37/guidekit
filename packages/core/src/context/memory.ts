/**
 * @module @guidekit/core/context/memory
 *
 * Tiered memory: working (in-memory) + session (sessionStorage).
 */

import type { ConversationTurn } from '../types/index.js';

const SESSION_MEMORY_KEY = 'guidekit:memory';

export interface MemoryTierOptions {
  maxWorkingTurns?: number;
  maxSessionTurns?: number;
}

export class TieredMemory {
  private working: ConversationTurn[] = [];
  private readonly maxWorking: number;
  private readonly maxSession: number;

  constructor(options: MemoryTierOptions = {}) {
    this.maxWorking = options.maxWorkingTurns ?? 20;
    this.maxSession = options.maxSessionTurns ?? 50;
  }

  addTurn(turn: ConversationTurn): void {
    this.working.push(turn);
    if (this.working.length > this.maxWorking) {
      this.working = this.working.slice(-this.maxWorking);
    }
    this.persistSession();
  }

  getWorkingMemory(): ConversationTurn[] {
    return this.working.slice();
  }

  /** Replace working memory (e.g. after session restore). */
  loadWorking(turns: ConversationTurn[]): void {
    this.working = turns.slice(-this.maxWorking);
    this.persistSession();
  }

  restoreFromSession(): ConversationTurn[] {
    if (typeof window === 'undefined' || !window.sessionStorage) return [];
    try {
      const raw = window.sessionStorage.getItem(SESSION_MEMORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as ConversationTurn[];
      this.working = parsed.slice(-this.maxWorking);
      return this.working.slice();
    } catch {
      return [];
    }
  }

  clear(): void {
    this.working = [];
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        window.sessionStorage.removeItem(SESSION_MEMORY_KEY);
      } catch {
        /* ignore */
      }
    }
  }

  private persistSession(): void {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    try {
      const toStore = this.working.slice(-this.maxSession);
      window.sessionStorage.setItem(SESSION_MEMORY_KEY, JSON.stringify(toStore));
    } catch {
      /* quota exceeded — best effort */
    }
  }
}
