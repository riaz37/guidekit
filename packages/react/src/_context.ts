import { createContext } from 'react';
import type { GuideKitCore } from '@guidekit/core';

export const GuideKitContext = createContext<GuideKitCore | null>(null);
