/**
 * @module @guidekit/core/pipeline
 *
 * Composable pipeline for GuideKit v2 message processing.
 */

export { PipelineOrchestrator } from './orchestrator.js';
export type {
  PipelineContext,
  PipelineDependencies,
  PipelineOrchestratorResult,
  PipelineStage,
  PipelineStageHooks,
  BeforeLLMCallContext,
} from './types.js';
export { PIPELINE_STAGES } from './types.js';
