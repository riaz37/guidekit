/**
 * @module @guidekit/core/telemetry
 *
 * OpenTelemetry-compatible span helpers for pipeline stages.
 */

import type { PipelineStage } from '../pipeline/types.js';

export interface TelemetrySpan {
  name: string;
  stage: PipelineStage;
  /**
   * Monotonic timestamps from `performance.now()` (ms).
   * Use these for reliable duration calculations.
   */
  startTime: number;
  endTime?: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface TelemetrySpanExport {
  /** Stable span name. */
  name: string;
  /** Pipeline stage this span corresponds to. */
  stage: PipelineStage;
  /** Epoch wall-clock start time (ms since Unix epoch). */
  startTimeEpochMs: number;
  /** Epoch wall-clock end time (ms since Unix epoch). */
  endTimeEpochMs?: number;
  /** Duration in milliseconds (monotonic). */
  durationMs?: number;
  /** Arbitrary span attributes (must be JSON-serializable primitives). */
  attributes: Record<string, string | number | boolean>;
}

export class PipelineTelemetry {
  private spans: TelemetrySpan[] = [];
  /**
   * Offset to convert monotonic `performance.now()` to epoch ms.
   * Computed once so all spans share the same mapping.
   */
  private readonly epochOffsetMs: number =
    typeof performance !== 'undefined'
      ? Date.now() - performance.now()
      : Date.now();

  startSpan(stage: PipelineStage, attributes?: Record<string, string | number | boolean>): TelemetrySpan {
    const span: TelemetrySpan = {
      name: `guidekit.pipeline.${stage}`,
      stage,
      startTime: performance.now(),
      attributes,
    };
    this.spans.push(span);
    return span;
  }

  endSpan(span: TelemetrySpan): void {
    span.endTime = performance.now();
  }

  setAttributes(
    span: TelemetrySpan,
    attributes: Record<string, string | number | boolean>,
  ): void {
    span.attributes = { ...(span.attributes ?? {}), ...attributes };
  }

  getSpans(): TelemetrySpan[] {
    return this.spans.slice();
  }

  clear(): void {
    this.spans = [];
  }

  /**
   * Export a stable, backend-friendly JSON format.
   *
   * Notes:
   * - We include epoch timestamps for correlation with server logs.
   * - Durations use monotonic time to avoid clock drift issues.
   */
  toJSON(): TelemetrySpanExport[] {
    return this.spans.map((s) => {
      const startEpoch = this.epochOffsetMs + s.startTime;
      const endEpoch = s.endTime !== undefined ? this.epochOffsetMs + s.endTime : undefined;
      return {
        name: s.name,
        stage: s.stage,
        startTimeEpochMs: startEpoch,
        endTimeEpochMs: endEpoch,
        durationMs: s.endTime ? s.endTime - s.startTime : undefined,
        attributes: { stage: s.stage, ...(s.attributes ?? {}) },
      };
    });
  }
}
