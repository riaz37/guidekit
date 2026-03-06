/**
 * @module @guidekit/intelligence
 *
 * Semantic page intelligence engine for the GuideKit SDK.
 * Provides component detection, error state detection, flow analysis,
 * and hallucination guarding on top of the core PageModel.
 */

// Classes
export { ComponentDetector } from './component-detector';
export { ErrorDetector } from './error-detector';
export { FlowDetector } from './flow-detector';
export { HeadingExtractor } from './heading-extractor';
export { HallucinationGuard } from './hallucination-guard';
export { SemanticScanner } from './semantic-scanner';

// Types
export type { SemanticScannerOptions } from './semantic-scanner';

// Version
export const INTELLIGENCE_VERSION = '0.1.0';
