# GuideKit

AI-powered user guidance SDK that adds an intelligent assistant overlay to any web application.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [`@guidekit/core`](./packages/core) | Core engine — DOM intelligence, LLM orchestration, context management | [![npm](https://img.shields.io/npm/v/@guidekit/core)](https://www.npmjs.com/package/@guidekit/core) |
| [`@guidekit/react`](./packages/react) | React bindings — Provider, hooks, and Shadow DOM widget | [![npm](https://img.shields.io/npm/v/@guidekit/react)](https://www.npmjs.com/package/@guidekit/react) |
| [`@guidekit/server`](./packages/server) | Server utilities — token generation and auth middleware | [![npm](https://img.shields.io/npm/v/@guidekit/server)](https://www.npmjs.com/package/@guidekit/server) |
| [`@guidekit/vad`](./packages/vad) | Voice Activity Detection — Silero ONNX model wrapper | [![npm](https://img.shields.io/npm/v/@guidekit/vad)](https://www.npmjs.com/package/@guidekit/vad) |
| [`@guidekit/cli`](./packages/cli) | CLI tools — init, doctor, generate-secret | [![npm](https://img.shields.io/npm/v/@guidekit/cli)](https://www.npmjs.com/package/@guidekit/cli) |
| [`@guidekit/vanilla`](./packages/vanilla) | Vanilla JS bundle — script-tag integration for non-React apps | [![npm](https://img.shields.io/npm/v/@guidekit/vanilla)](https://www.npmjs.com/package/@guidekit/vanilla) |

## Quick Start

### 1. Install

```bash
npm install @guidekit/core @guidekit/react @guidekit/server
```

### 2. Create a token endpoint

```typescript
// app/api/guidekit/token/route.ts
import { createSessionToken } from '@guidekit/server';

export async function POST() {
  const token = await createSessionToken({
    signingSecret: process.env.GUIDEKIT_SECRET!,
    geminiKey: process.env.GEMINI_KEY!,
    expiresIn: '15m',
  });
  return Response.json(token);
}
```

### 3. Wrap your app

```tsx
import { GuideKitProvider } from '@guidekit/react';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <GuideKitProvider
      tokenEndpoint="/api/guidekit/token"
      agent={{ name: 'Guide', greeting: 'Hi! How can I help?' }}
      options={{ mode: 'text' }}
    >
      {children}
    </GuideKitProvider>
  );
}
```

### 4. Verify

```bash
npx guidekit doctor
```

## Documentation

Full documentation is available at [guidekit.dev/docs](https://guidekit.dev/docs).

- [Getting Started](https://guidekit.dev/docs/getting-started)
- [Provider Setup](https://guidekit.dev/docs/provider)
- [Hooks API](https://guidekit.dev/docs/hooks)
- [Voice](https://guidekit.dev/docs/voice)
- [Architecture](https://guidekit.dev/docs/architecture)

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test:unit

# Type check
pnpm typecheck

# Lint
pnpm lint
```

## License

[MIT](./LICENSE)
