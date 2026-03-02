# @guidekit/server

Server-side utilities for the GuideKit SDK. Provides secure token generation and validation so API keys never reach the browser.

## Installation

```bash
npm install @guidekit/server
```

## Token Generation

Create a token endpoint that the client SDK calls to obtain a short-lived session token.

```typescript
import { createSessionToken } from '@guidekit/server';

// Next.js App Router example
export async function POST() {
  const token = await createSessionToken({
    signingSecret: process.env.GUIDEKIT_SECRET!,
    geminiKey: process.env.GEMINI_KEY!,
    deepgramKey: process.env.DEEPGRAM_KEY,
    elevenlabsKey: process.env.ELEVENLABS_KEY,
    expiresIn: '15m',
  });

  return Response.json(token);
}
```

## Token Validation

Validate an incoming token (useful for custom middleware):

```typescript
import { validateSessionToken } from '@guidekit/server';

const payload = await validateSessionToken({
  token: bearerToken,
  signingSecret: process.env.GUIDEKIT_SECRET!,
});
```

## Secret Rotation

To rotate your signing secret with zero downtime, temporarily accept both old and new secrets:

```typescript
const token = await createSessionToken({
  signingSecret: process.env.GUIDEKIT_SECRET_NEW!,
  // ...
});
```

Generate a new secret via the CLI:

```bash
npx guidekit generate-secret
```

## Documentation

Full documentation: [guidekit.dev/docs/server](https://guidekit.dev/docs/server)

## License

[MIT](../../LICENSE)
