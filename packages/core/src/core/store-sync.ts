import type { AgentState, GuideKitStore } from '../types/index.js';

export class StoreSync {
  private listeners = new Set<() => void>();
  private snapshot: GuideKitStore;

  constructor(
    private readonly getState: () => {
      isReady: boolean;
      agentState: AgentState;
      isStreaming: boolean;
      streamingText: string;
    },
  ) {
    this.snapshot = this.buildSnapshot();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): GuideKitStore {
    return this.snapshot;
  }

  notify(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }

  private buildSnapshot(): GuideKitStore {
    const { isReady, agentState, isStreaming, streamingText } = this.getState();
    return {
      status: {
        isReady,
        agentState,
        error: agentState.status === 'error' ? agentState.error : null,
      },
      voice: {
        isListening: agentState.status === 'listening',
        isSpeaking: agentState.status === 'speaking',
      },
      streaming: { isStreaming, streamingText },
    };
  }
}
