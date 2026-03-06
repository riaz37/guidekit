# @guidekit/server

[![npm version](https://img.shields.io/npm/v/@guidekit/server?style=flat-square)](https://www.npmjs.com/package/@guidekit/server)

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
    llmApiKey: process.env.LLM_API_KEY!,
    sttApiKey: process.env.STT_API_KEY,
    ttsApiKey: process.env.TTS_API_KEY,
    expiresIn: '15m',
  });

  return Response.json(token);
}
```

## Token Validation

Validate an incoming token (useful for custom middleware):

```typescript
import { validateSessionToken } from '@guidekit/server';

const result = await validateSessionToken(
  bearerToken,
  process.env.GUIDEKIT_SECRET!,
);

if (result.valid) {
  console.log(result.payload);
}
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

- Full documentation: [guidekit-docs.vercel.app/docs/server](https://guidekit-docs.vercel.app/docs/server)
- [Main README](../../README.md)

## License

[MIT](../../LICENSE)
