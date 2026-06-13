export interface TranscriptMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface WidgetProps {
  theme?: {
    primaryColor?: string;
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    borderRadius?: string;
    zIndex?: number | string;
  };
  consentRequired?: boolean;
  instanceId?: string;
}
