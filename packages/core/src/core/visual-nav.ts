import type { EventBus } from '../bus/index.js';
import type { NavigationController } from '../navigation/index.js';
import type { VisualGuidance } from '../visual/index.js';
import type { VisualGuidanceApi } from './visual-api.js';

export class VisualNavController implements VisualGuidanceApi {
  constructor(
    private readonly bus: EventBus,
    private getVisual: () => VisualGuidance | null,
    private getNavigation: () => NavigationController | null,
  ) {}

  highlight(params: {
    sectionId?: string;
    selector?: string;
    tooltip?: string;
    position?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
  }): boolean {
    const visual = this.getVisual();
    if (!visual) return false;
    const result = visual.highlight(params);
    if (result) {
      this.bus.emit('visual:spotlight-shown', {
        selector: params.selector ?? params.sectionId ?? '',
        sectionId: params.sectionId,
      });
    }
    return result;
  }

  dismissHighlight(): void {
    this.getVisual()?.dismissHighlight();
    this.bus.emit('visual:spotlight-dismissed', {});
  }

  scrollToSection(sectionId: string, offset?: number): void {
    this.getVisual()?.scrollToSection(sectionId, offset);
  }

  scrollToSelector(selector: string, offset?: number): void {
    this.getVisual()?.scrollToSelector(selector, offset);
  }

  startTour(sectionIds: string[], mode?: 'auto' | 'manual'): void {
    this.getVisual()?.startTour(sectionIds, mode);
  }

  nextTourStep(): void {
    this.getVisual()?.nextTourStep();
  }

  prevTourStep(): void {
    this.getVisual()?.prevTourStep();
  }

  stopTour(): void {
    this.getVisual()?.stopTour();
  }

  async navigate(href: string): Promise<boolean> {
    const nav = this.getNavigation();
    if (!nav) return false;
    return nav.navigate(href);
  }
}
