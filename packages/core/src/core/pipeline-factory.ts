/**
 * Pipeline orchestrator factory and stage-hook merging.
 */

import { PipelineOrchestrator } from '../pipeline/index.js';
import type { PipelineStageHooks } from '../pipeline/index.js';
import type { PipelineContext } from '../pipeline/types.js';
import type { PipelineDependencies } from '../pipeline/types.js';

export function mergeStageHooks(
  platform?: PipelineStageHooks,
  custom?: PipelineStageHooks,
): PipelineStageHooks | undefined {
  if (!platform && !custom) return undefined;
  return {
    enrich: chainHook(platform?.enrich, custom?.enrich),
    retrieve: chainHook(platform?.retrieve, custom?.retrieve),
    cognize: chainHook(platform?.cognize, custom?.cognize),
    validate: chainHook(platform?.validate, custom?.validate),
  };
}

function chainHook<T extends (ctx: PipelineContext) => PipelineContext | Promise<PipelineContext>>(
  first?: T,
  second?: T,
): T | undefined {
  if (!first) return second;
  if (!second) return first;
  return (async (ctx) => second(await first(ctx))) as T;
}

export function createPipelineOrchestrator(deps: PipelineDependencies): PipelineOrchestrator {
  return new PipelineOrchestrator(deps);
}
