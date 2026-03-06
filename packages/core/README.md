# @guidekit/core

[![npm version](https://img.shields.io/npm/v/@guidekit/core/beta?style=flat-square)](https://www.npmjs.com/package/@guidekit/core)

Core engine for the GuideKit SDK. Provides DOM intelligence, LLM orchestration, context management, and the typed event system that powers all GuideKit integrations.

> **Beta:** This package is in beta. Install with the `@beta` tag.

## Installation

```bash
npm install @guidekit/core@beta
```

## Overview

`@guidekit/core` is the foundation layer used by `@guidekit/react` and `@guidekit/vanilla`. You typically do not need to use it directly unless you are building a custom integration.

## API

### GuideKitCore

The main class that orchestrates all SDK subsystems.

```typescript
import { GuideKitCore } from '@guidekit/core';

const core = new GuideKitCore({
  tokenEndpoint: '/api/guidekit/token',
  agent: { name: 'Guide', greeting: 'Hello!' },
  options: { mode: 'text', debug: false },
});

await core.init();

// Send a text message
const response = await core.sendText('How do I reset my password?');

// Clean up
core.destroy();
```

### EventBus

Typed event system with namespace subscriptions and error isolation.

```typescript
core.events.on('status:change', (status) => {
  console.log('Status:', status);
});

core.events.on('error', (error) => {
  console.log(error.code, error.suggestion);
});
```

### Error Hierarchy

All errors extend `GuideKitError` with structured metadata:

- `code` — One of 28 canonical error codes
- `suggestion` — Actionable fix for the user
- `recoverable` — Whether the SDK can continue operating
- `docsUrl` — Link to the relevant documentation page

## Key Subsystems

- **DOM Scanner** — TreeWalker-based page model with `data-guidekit-ignore` support
- **Context Manager** — Token budgeting and truncation for LLM context windows
- **LLM Orchestrator** — Streaming responses with tool calling (Gemini (default), custom adapters via `LLMProviderAdapter`)
- **Resource Manager** — AbortController pattern and lifecycle tracking

## Documentation

- Full documentation: [guidekit.dev/docs](https://guidekit.dev/docs)
- [Main README](../../README.md)

## License

[MIT](../../LICENSE)
