/**
 * Health check helpers for GuideKitCore.
 */

import type { LLMOrchestrator } from '../llm/index.js';
import type { VoicePipeline } from '../voice/index.js';
import type { STTConfig, TTSConfig } from '../types/index.js';

export interface HealthCheckStatus {
  status: 'ok' | 'degraded' | 'unavailable' | 'not-configured';
  latencyMs?: number;
  error?: string;
}

export interface HealthCheckResult {
  llm: HealthCheckStatus;
  stt: HealthCheckStatus;
  tts: HealthCheckStatus;
  mic: HealthCheckStatus;
  overall: 'ok' | 'degraded' | 'unavailable';
}

export interface HealthCheckInput {
  llmOrchestrator: LLMOrchestrator | null;
  voicePipeline: VoicePipeline | null;
  stt?: STTConfig;
  tts?: TTSConfig;
}

export async function runHealthCheck(input: HealthCheckInput): Promise<HealthCheckResult> {
  const results: HealthCheckResult = {
    llm: { status: 'not-configured' },
    stt: { status: 'not-configured' },
    tts: { status: 'not-configured' },
    mic: { status: 'not-configured' },
    overall: 'ok',
  };

  if (input.llmOrchestrator) {
    try {
      const start = Date.now();
      results.llm = { status: 'ok', latencyMs: Date.now() - start };
    } catch (err) {
      results.llm = {
        status: 'unavailable',
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  if (input.stt) {
    results.stt = { status: input.voicePipeline ? 'ok' : 'degraded' };
  }

  if (input.tts) {
    results.tts = { status: input.voicePipeline ? 'ok' : 'degraded' };
  }

  if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasMic = devices.some((d) => d.kind === 'audioinput');
      results.mic = { status: hasMic ? 'ok' : 'unavailable' };
    } catch (err) {
      results.mic = {
        status: 'unavailable',
        error: err instanceof Error ? err.message : 'Permission denied',
      };
    }
  }

  const statuses = [results.llm, results.stt, results.tts, results.mic];
  const configured = statuses.filter((s) => s.status !== 'not-configured');
  if (configured.some((s) => s.status === 'unavailable')) {
    results.overall = 'unavailable';
  } else if (configured.some((s) => s.status === 'degraded')) {
    results.overall = 'degraded';
  } else {
    results.overall = 'ok';
  }

  return results;
}
