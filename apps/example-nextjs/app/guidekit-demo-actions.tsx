'use client';

import { useEffect } from 'react';
import { useGuideKitContext } from '@guidekit/react';

/** Registers a sample custom action the agent can invoke. */
export function GuideKitDemoActions() {
  const { registerAction } = useGuideKitContext();

  useEffect(() => {
    registerAction('showAlert', {
      description: 'Show a friendly alert message to the user',
      parameters: {
        message: { type: 'string', description: 'Message to display' },
      },
      handler: async ({ message }) => {
        const text = typeof message === 'string' ? message : 'Hello from GuideKit!';
        if (typeof window !== 'undefined') {
          window.alert(text);
        }
        return { success: true, message: `Alert shown: ${text}` };
      },
    });
  }, [registerAction]);

  return null;
}
