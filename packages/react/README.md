# @guidekit/react

[![npm version](https://img.shields.io/npm/v/@guidekit/react?style=flat-square)](https://www.npmjs.com/package/@guidekit/react)

React bindings for the GuideKit SDK. Provides the `GuideKitProvider`, split hooks, and a Shadow DOM widget for adding an AI assistant to any React application.

## Installation

```bash
npm install @guidekit/core @guidekit/react
```

## Quick Start

```tsx
import { GuideKitProvider } from '@guidekit/react';

function App() {
  return (
    <GuideKitProvider
      tokenEndpoint="/api/guidekit/token"
      agent={{ name: 'Guide', greeting: 'Hi! How can I help?' }}
      options={{ mode: 'text' }}
    >
      <YourApp />
    </GuideKitProvider>
  );
}
```

## Hooks

```tsx
import {
  useGuideKitStatus,
  useGuideKitVoice,
  useGuideKitActions,
  useGuideKitContext,
} from '@guidekit/react';

function MyComponent() {
  const { status, isReady } = useGuideKitStatus();
  const { sendText, reset } = useGuideKitActions();
  const { isListening, startVoice, stopVoice } = useGuideKitVoice();
  const { transcript, messages } = useGuideKitContext();

  return (
    <div>
      <p>Status: {status}</p>
      <button onClick={() => sendText('Help me')}>Ask</button>
    </div>
  );
}
```

## Sub-exports

### `@guidekit/react/devtools`

Development-only component for inspecting SDK state, events, and context.

```tsx
import { GuideKitDevTools } from '@guidekit/react/devtools';
```

### `@guidekit/react/testing`

Test utilities for mocking the provider in unit tests.

```tsx
import { MockGuideKitProvider, simulateVoiceInput } from '@guidekit/react/testing';
```

## Documentation

- Full documentation: [guidekit-docs.vercel.app/docs](https://guidekit-docs.vercel.app/docs)
- [Main README](../../README.md)

## License

[MIT](../../LICENSE)
