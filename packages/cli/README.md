# @guidekit/cli

[![npm version](https://img.shields.io/npm/v/@guidekit/cli?style=flat-square)](https://www.npmjs.com/package/@guidekit/cli)

CLI tools for the GuideKit SDK. Scaffolds projects, diagnoses configuration issues, and generates signing secrets.

## Installation

```bash
npm install -g @guidekit/cli
```

Or use directly with `npx`:

```bash
npx @guidekit/cli <command>
```

## Commands

### `guidekit init`

Scaffolds GuideKit into your project. Detects your framework (Next.js App Router, Pages Router, or generic React) and generates:

- `lib/guidekit-routes.ts` plus `/api/guidekit/{token,llm,health}` routes (Next.js App Router)
- Provider component with `tokenEndpoint`, `proxy`, and `llm` model config
- `.env.local` template with required keys

```bash
npx guidekit init
npx guidekit init --platform   # also scaffolds STT/TTS routes and Platform Mode props
```

### `guidekit doctor`

Checks your environment for common issues:

- Required environment variables are set
- Packages are installed at compatible versions
- Proxy route files and provider wiring (Next.js App Router)
- Local `/api/guidekit/token` and `/api/guidekit/health` when the dev server is running
- External provider API reachability (Google AI, Deepgram, ElevenLabs)

```bash
npx guidekit doctor
```

### `guidekit generate-secret`

Generates a cryptographically secure signing secret for token generation.

```bash
npx guidekit generate-secret
```

Copy the output into your `.env.local` as `GUIDEKIT_SECRET`.

## Documentation

- Full documentation: [guidekit-docs.vercel.app/docs/cli](https://guidekit-docs.vercel.app/docs/cli)
- [Main README](../../README.md)

## License

[MIT](../../LICENSE)
