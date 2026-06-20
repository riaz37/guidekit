# @guidekit/react

<p align="center">
  <a href="https://guidekit-docs.vercel.app">
    <img src="../../assets/brand/wordmark.svg" alt="GuideKit" width="200" />
  </a>
</p>

<p align="center">
  <a href="https://guidekit-docs.vercel.app/docs/getting-started">Documentation</a>
  ·
  <a href="https://github.com/riaz37/guidekit">GitHub</a>
</p>

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

## Headless / custom UI

Skip the built-in widget and own the full interface (any layout, corner, sidebar, or embed):

```tsx
import { GuideKitProvider, useGuideKitStatus, useGuideKitVoice } from '@guidekit/react';

function App() {
  return (
    <GuideKitProvider headless tokenEndpoint="/api/guidekit/token">
      <YourApp />
      <MyAssistant />
    </GuideKitProvider>
  );
}

function MyAssistant() {
  const { isReady } = useGuideKitStatus();
  const { sendText } = useGuideKitVoice();
  // Build your own FAB, panel, or inline UI with normal React + CSS
}
```

See [Custom UI docs](https://guidekit-docs.vercel.app/docs/custom-ui) for streaming, consent, and positioning examples.

## Hooks

```tsx
import {
  useGuideKitStatus,
  useGuideKitVoice,
  useGuideKitActions,
  useGuideKitContext,
} from '@guidekit/react';

function MyComponent() {
  const { isReady, agentState } = useGuideKitStatus();
  const { isListening, startListening, stopListening, sendText } = useGuideKitVoice();
  const { highlight, scrollToSection, startTour, navigate } = useGuideKitActions();
  const { setPageContext, registerAction } = useGuideKitContext();

  return (
    <div>
      <p>Status: {agentState.status}</p>
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

DevTools includes a **Telemetry** tab for per-message pipeline stage timings (useful for debugging latency and token-heavy turns).

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
