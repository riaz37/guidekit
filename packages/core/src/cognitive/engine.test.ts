import { describe, it, expect } from 'vitest';
import { CognitiveEngine } from './engine.js';

describe('CognitiveEngine', () => {
  it('bypasses cognitive loop for simple highlight queries', () => {
    const engine = new CognitiveEngine();
    const result = engine.process('highlight the submit button', []);
    expect(result.useStandardPipeline).toBe(true);
    expect(result.complexity).toBe('simple');
    expect(result.maxToolRounds).toBe(3);
  });

  it('plans multi-step guidance for walkthrough queries', () => {
    const engine = new CognitiveEngine();
    const result = engine.process('Walk me through this 4-step checkout process', [
      { name: 'highlight', description: 'Highlight', parameters: {}, schemaVersion: 1 },
    ]);
    expect(result.useStandardPipeline).toBe(false);
    expect(result.complexity).toBe('complex');
    expect(result.systemPromptAddition).toContain('Multi-Step Guidance Mode');
    expect(result.plannedActions?.length).toBeGreaterThan(1);
    expect(result.maxToolRounds).toBeGreaterThan(5);
  });
});
