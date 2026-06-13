import { useContext } from 'react';
import type { GuideKitCore } from '@guidekit/core';
import { GuideKitContext } from '../_context.js';

export function useGuideKitCore(): GuideKitCore | null {
  return useContext(GuideKitContext);
}
