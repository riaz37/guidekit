<p align="center">
  <img src="https://img.shields.io/npm/v/@guidekit/core?label=core&color=6366f1&style=flat-square" alt="core version" />
  <img src="https://img.shields.io/npm/v/@guidekit/react?label=react&color=6366f1&style=flat-square" alt="react version" />
  <img src="https://img.shields.io/npm/v/@guidekit/server?label=server&color=6366f1&style=flat-square" alt="server version" />
  <img src="https://img.shields.io/github/license/riaz37/guidekit?style=flat-square" alt="license" />
  <img src="https://img.shields.io/badge/tests-949%20passing-brightgreen?style=flat-square" alt="tests" />
  <img src="https://img.shields.io/badge/TypeScript-strict-blue?style=flat-square" alt="typescript" />
</p>

<h1 align="center">GuideKit</h1>

<p align="center">
  <strong>AI-powered user guidance SDK that understands your website and guides users through it — like a human sitting beside them.</strong>
</p>

<p align="center">
  <a href="https://guidekit.dev/docs/getting-started">Getting Started</a> ·
  <a href="https://guidekit.dev/docs">Documentation</a> ·
  <a href="https://guidekit.dev/docs/architecture">Architecture</a> ·
  <a href="#quick-start">Quick Start</a>
</p>

---

## Why GuideKit?

Existing solutions fall short:

- **Voice SDKs** (Vapi, ElevenLabs, LiveKit) — great voice, zero DOM awareness
- **Browser AI agents** (Browser-Use, Stagehand) — server-side automation, not embeddable
- **Support widgets** (Intercom, Zendesk) — scripted flows, no real understanding

**GuideKit** combines all three: an embeddable SDK where the AI agent *sees* your page, *understands* its structure, and *guides* users with voice, text, and visual cues — spotlights, tooltips, scrolling, and navigation.

## Features

- **DOM Intelligence** — Auto-discovers site structure, content, navigation, forms, and overlays
- **Text + Voice** — Full conversation via text or voice (Deepgram STT + ElevenLabs TTS)
- **Visual Guidance** — Spotlight overlay, tooltips, smooth scrolling, guided tours
- **LLM Tool Calling** — highlight, scroll, navigate, click, and custom developer actions
- **User Awareness** — Viewport tracking, dwell/idle detection, rage click detection
- **Proactive Triggers** — Context-aware suggestions with progressive cooldowns
- **Token-Based Auth** — API keys never reach the browser
- **React + Vanilla** — First-class React hooks or plain `<script>` tag
- **Accessible** — WCAG 2.1 AA, keyboard navigation, screen reader support
- **Lightweight** — Core ~65 KB gz, React ~8 KB gz, tree-shakeable

## Packages

| Package | Description | Size (gz) |
|---------|-------------|-----------|
| [`@guidekit/core`](./packages/core) | Core engine — DOM intelligence, LLM orchestration, context management | 64.93 KB |
| [`@guidekit/react`](./packages/react) | React bindings — Provider, hooks, Shadow DOM widget | 7.73 KB |
| [`@guidekit/server`](./packages/server) | Server utilities — token generation, session management | 1.81 KB |
| [`@guidekit/vanilla`](./packages/vanilla) | Vanilla JS — IIFE bundle for non-React apps | 92.36 KB |
| [`@guidekit/vad`](./packages/vad) | Voice Activity Detection — Silero ONNX model | 22.8 KB |
| [`@guidekit/cli`](./packages/cli) | CLI — `init`, `doctor`, `generate-secret` | 4.83 KB |

## Quick Start

### Install

```bash
npm install @guidekit/react@beta @guidekit/server@beta
```

### 1. Generate a signing secret

```bash
npx @guidekit/cli@beta generate-secret
```

Add it to `.env.local`:

```env
GUIDEKIT_SECRET=your-generated-secret
GEMINI_KEY=your-gemini-api-key
```

### 2. Create a token endpoint (Next.js App Router)

```typescript
// app/api/guidekit/token/route.ts
import { createSessionToken } from '@guidekit/server';

export async function POST() {
  const token = await createSessionToken({
    signingSecret: process.env.GUIDEKIT_SECRET!,
    geminiKey: process.env.GEMINI_KEY!,
    expiresIn: '15m',
    allowedOrigins: ['https://yourapp.com'],
  });
  return Response.json(token);
}
```

### 3. Wrap your app in the Provider

```tsx
// app/providers.tsx
'use client';

import { GuideKitProvider } from '@guidekit/react';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GuideKitProvider
      tokenEndpoint="/api/guidekit/token"
      agent={{ name: 'Guide', greeting: 'Hi! How can I help you today?' }}
      options={{ mode: 'text', debug: process.env.NODE_ENV === 'development' }}
    >
      {children}
    </GuideKitProvider>
  );
}
```

```tsx
// app/layout.tsx
import { Providers } from './providers';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html><body>
      <Providers>{children}</Providers>
    </body></html>
  );
}
```

### 4. Verify your setup

```bash
npx @guidekit/cli@beta doctor
```

That's it. A chat widget appears on your site. The agent auto-discovers your pages and can answer questions, spotlight elements, navigate users, and execute custom actions.

## React Hooks

GuideKit provides focused hooks that minimize re-renders:

```tsx
import {
  useGuideKitStatus,
  useGuideKitVoice,
  useGuideKitActions,
  useGuideKitContext,
} from '@guidekit/react';

function MyComponent() {
  // Status — re-renders only on status changes
  const { isReady, agentState, error } = useGuideKitStatus();

  // Voice — re-renders only on voice state changes
  const { isListening, isSpeaking, startListening, stopListening, sendText } = useGuideKitVoice();

  // Actions — never re-renders (stable refs)
  const { highlight, dismissHighlight, scrollToSection, startTour } = useGuideKitActions();

  // Context — never re-renders (stable refs)
  const { setPageContext, registerAction } = useGuideKitContext();
}
```

## Custom Actions

Register domain-specific actions the AI can invoke:

```tsx
const { registerAction } = useGuideKitContext();

registerAction('addToCart', {
  description: 'Add a product to the shopping cart',
  parameters: { productId: 'string', quantity: 'number' },
  handler: async ({ productId, quantity }) => {
    await cart.add(productId, quantity);
    return { success: true, message: `Added ${quantity} item(s)` };
  },
});

// The AI can now say: "I've added that to your cart!"
// while executing the action behind the scenes.
```

## Content Map (Prevent Hallucination)

Provide ground-truth content the AI references instead of guessing:

```tsx
<GuideKitProvider
  contentMap={{
    'section-pricing': {
      description: 'Pricing starts at $29/mo for the Starter plan',
      facts: ['14-day free trial', 'No credit card required'],
    },
  }}
>
```

Or use a dynamic function for runtime data:

```tsx
<GuideKitProvider
  contentMap={(sectionId) => {
    if (sectionId === 'section-inventory') {
      return { description: `${inventory.count} items in stock` };
    }
    return null;
  }}
>
```

## Vanilla JS (Non-React)

Use GuideKit with a script tag — no build tools required:

```html
<script src="https://cdn.jsdelivr.net/npm/@guidekit/vanilla@beta/dist/index.global.js"></script>
<script>
  GuideKit.init({
    tokenEndpoint: '/api/guidekit/token',
    agent: { name: 'Guide', greeting: 'Hello!' },
  });
</script>
```

Or via npm:

```typescript
import { init, sendText, highlight, destroy } from '@guidekit/vanilla';

await init({ tokenEndpoint: '/api/guidekit/token' });
const response = await sendText('What is this page about?');
```

## Voice Mode

Enable voice with STT/TTS providers:

```tsx
<GuideKitProvider
  tokenEndpoint="/api/guidekit/token"
  options={{ mode: 'voice' }}
>
```

Server-side, add provider keys:

```typescript
const token = await createSessionToken({
  signingSecret: process.env.GUIDEKIT_SECRET!,
  geminiKey: process.env.GEMINI_KEY!,
  deepgramKey: process.env.DEEPGRAM_KEY!,
  elevenlabsKey: process.env.ELEVENLABS_KEY!,
  expiresIn: '15m',
});
```

Install the VAD package for voice activity detection:

```bash
npm install @guidekit/vad@beta
```

Voice features include:
- Half-duplex (no echo issues) with barge-in support
- Automatic degradation to text-only if voice fails
- Real-time captions always displayed
- Browser autoplay policy compliance (no auto-play audio)

## DevTools & Testing

```tsx
// Development only — pipeline inspector, latency waterfall, section viewer
import { GuideKitDevTools } from '@guidekit/react/devtools';

{process.env.NODE_ENV === 'development' && <GuideKitDevTools />}
```

```tsx
// Testing — mock provider for unit tests
import { MockGuideKitProvider, simulateVoiceInput } from '@guidekit/react/testing';

<MockGuideKitProvider initialState={{ isReady: true }}>
  <ComponentUnderTest />
</MockGuideKitProvider>
```

## Security

- **API keys never reach the browser** — stored server-side, accessed via short-lived JWT tokens
- **Token refresh** — automatic at 80% TTL with multi-tab coordination
- **Click safety** — default deny-list blocks submit/reset/form clicks by LLM
- **Privacy hooks** — `onBeforeLLMCall` for custom PII scrubbing
- **DOM exclusion** — `data-guidekit-ignore` attribute skips sensitive subtrees
- **XSS prevention** — all tooltip content rendered via `textContent`, never `innerHTML`
- **Input validation** — configurable `maxMessageLength` (default 10,000 chars)
- **Concurrent request guard** — prevents double-submission

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    @guidekit/react                       │
│              Provider · Hooks · Widget (Shadow DOM)      │
├─────────────────────────────────────────────────────────┤
│                    @guidekit/core                        │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌───────────┐ │
│  │   DOM    │ │ Context  │ │    LLM    │ │  Visual   │ │
│  │ Scanner  │ │ Manager  │ │Orchestrator│ │ Guidance  │ │
│  └──────────┘ └──────────┘ └───────────┘ └───────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌───────────┐ │
│  │  Voice   │ │Awareness │ │Navigation │ │ EventBus  │ │
│  │ Pipeline │ │  System  │ │Controller │ │& Resources│ │
│  └──────────┘ └──────────┘ └───────────┘ └───────────┘ │
├─────────────────────────────────────────────────────────┤
│                   @guidekit/server                       │
│           Token Generation · Session Management          │
└─────────────────────────────────────────────────────────┘
```

## Documentation

| Topic | Link |
|-------|------|
| Getting Started | [guidekit.dev/docs/getting-started](https://guidekit.dev/docs/getting-started) |
| Provider Setup | [guidekit.dev/docs/provider](https://guidekit.dev/docs/provider) |
| Hooks API | [guidekit.dev/docs/hooks](https://guidekit.dev/docs/hooks) |
| Voice | [guidekit.dev/docs/voice](https://guidekit.dev/docs/voice) |
| Server SDK | [guidekit.dev/docs/server](https://guidekit.dev/docs/server) |
| Privacy & Security | [guidekit.dev/docs/privacy](https://guidekit.dev/docs/privacy) |
| Error Codes | [guidekit.dev/docs/error-codes](https://guidekit.dev/docs/error-codes) |
| Architecture | [guidekit.dev/docs/architecture](https://guidekit.dev/docs/architecture) |
| Vanilla (Non-React) | [guidekit.dev/docs/vanilla](https://guidekit.dev/docs/vanilla) |

## Development

```bash
# Prerequisites: Node 20+, pnpm 10+
pnpm install        # Install dependencies
pnpm build          # Build all 8 packages
pnpm typecheck      # TypeScript strict mode
pnpm lint           # ESLint
pnpm test:unit      # 949 unit tests
pnpm test:e2e       # Playwright E2E tests
pnpm size:check     # Bundle size limits
```

### Project Structure

```
guidekit/
├── packages/
│   ├── core/       # @guidekit/core — engine
│   ├── react/      # @guidekit/react — Provider + hooks
│   ├── server/     # @guidekit/server — token auth
│   ├── vanilla/    # @guidekit/vanilla — IIFE bundle
│   ├── vad/        # @guidekit/vad — Silero VAD
│   └── cli/        # @guidekit/cli — tooling
├── apps/
│   ├── docs/            # Documentation (Nextra)
│   ├── example-nextjs/  # Reference Next.js app
│   └── playground/      # Interactive demo
└── e2e/                 # Playwright E2E tests
```

## Contributing

Contributions are welcome! Please read the [CHANGELOG](./CHANGELOG.md) to understand the current state.

```bash
# Fork, clone, then:
pnpm install
pnpm build
pnpm test:unit      # Make sure everything passes
# Create a branch, make changes, submit a PR
```

## License

[MIT](./LICENSE) — Copyright (c) 2025 GuideKit
