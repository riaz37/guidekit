// @guidekit/react — public entry (re-exports)

export { GuideKitProvider } from './provider.js';
export {
  useGuideKitCore,
  useGuideKitStatus,
  useGuideKitVoice,
  useGuideKitActions,
  useGuideKitContext,
  useGuideKitStream,
  useGuideKit,
} from './hooks/index.js';
export { GuideKitWidget } from './widget/index.js';
export type { WidgetProps } from './widget/types.js';

export type {
  GuideKitCoreOptions,
  GuideKitProviderProps,
  AgentState,
  GuideKitStore,
  GuideKitErrorType,
  GuideKitEvent,
  StreamResult,
  TextStream,
} from '@guidekit/core';
