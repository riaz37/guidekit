/**
 * @module SemanticScanner
 *
 * Thin orchestration layer that composes all intelligence detectors into a
 * single `scan()` call, enriching a base `PageModel` into a `SemanticPageModel`.
 */

import type { PageModel, SemanticPageModel } from '@guidekit/core';

import { ComponentDetector } from './component-detector';
import { ErrorDetector } from './error-detector';
import { FlowDetector } from './flow-detector';
import { HeadingExtractor } from './heading-extractor';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface SemanticScannerOptions {
  enableComponents?: boolean; // default: true
  enableErrors?: boolean; // default: true
  enableFlow?: boolean; // default: true
  enableHeadings?: boolean; // default: true
}

// ---------------------------------------------------------------------------
// SemanticScanner
// ---------------------------------------------------------------------------

export class SemanticScanner {
  private readonly componentDetector: ComponentDetector;
  private readonly errorDetector: ErrorDetector;
  private readonly flowDetector: FlowDetector;
  private readonly headingExtractor: HeadingExtractor;
  private readonly options: Required<SemanticScannerOptions>;

  constructor(options: SemanticScannerOptions = {}) {
    this.options = {
      enableComponents: options.enableComponents ?? true,
      enableErrors: options.enableErrors ?? true,
      enableFlow: options.enableFlow ?? true,
      enableHeadings: options.enableHeadings ?? true,
    };

    this.componentDetector = new ComponentDetector();
    this.errorDetector = new ErrorDetector();
    this.flowDetector = new FlowDetector();
    this.headingExtractor = new HeadingExtractor();
  }

  /**
   * Run all enabled detectors against `root` and enrich the base page model.
   */
  scan(root: Element, basePageModel: PageModel): SemanticPageModel {
    const { enableComponents, enableErrors, enableFlow, enableHeadings } =
      this.options;

    return {
      ...basePageModel,
      components: enableComponents
        ? this.componentDetector.detect(root)
        : [],
      errorStates: enableErrors
        ? this.errorDetector.detect(root)
        : [],
      flowState: enableFlow
        ? this.flowDetector.detect(root)
        : null,
      headingOutline: enableHeadings
        ? this.headingExtractor.extract(root)
        : [],
    };
  }

  /**
   * Run `scan()` and return the result alongside the elapsed time in
   * milliseconds, useful for performance benchmarking.
   */
  scanWithTiming(
    root: Element,
    basePageModel: PageModel,
  ): { model: SemanticPageModel; durationMs: number } {
    const start = performance.now();
    const model = this.scan(root, basePageModel);
    const durationMs = performance.now() - start;
    return { model, durationMs };
  }
}
