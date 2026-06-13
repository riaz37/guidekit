/**
 * @module @guidekit/core/telemetry
 *
 * OpenTelemetry-compatible span helpers for pipeline stages.
 */

import type { PipelineStage } from '../pipeline/types.js';

export interface TelemetrySpan {
  name: string;
  stage: PipelineStage;
  startTime: number;
  endTime?: number;
  attributes?: Record<string, string | number | boolean>;
}

export class PipelineTelemetry {
  private spans: TelemetrySpan[] = [];

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

  getSpans(): TelemetrySpan[] {
    return this.spans.slice();
  }

  clear(): void {
    this.spans = [];
  }

  /** Export as OTEL-like JSON for observability backends. */
  toJSON(): Array<Record<string, unknown>> {
    return this.spans.map((s) => ({
      name: s.name,
      startTimeUnixNano: Math.round(s.startTime * 1e6),
      endTimeUnixNano: s.endTime ? Math.round(s.endTime * 1e6) : undefined,
      attributes: { stage: s.stage, ...s.attributes },
      durationMs: s.endTime ? s.endTime - s.startTime : undefined,
    }));
  }
}
