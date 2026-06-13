/** Visual + navigation surface used by built-in tools. */

export interface VisualGuidanceApi {
  highlight(params: {
    sectionId?: string;
    selector?: string;
    tooltip?: string;
    position?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
  }): boolean;
  dismissHighlight(): void;
  scrollToSection(sectionId: string, offset?: number): void;
  scrollToSelector(selector: string, offset?: number): void;
  startTour(sectionIds: string[], mode?: 'auto' | 'manual'): void;
  nextTourStep(): void;
  prevTourStep(): void;
  stopTour(): void;
  navigate(href: string): Promise<boolean>;
}
