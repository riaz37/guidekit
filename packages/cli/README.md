# @guidekit/cli

CLI tools for the GuideKit SDK. Scaffolds projects, diagnoses configuration issues, and generates signing secrets.

## Installation

```bash
npm install -g @guidekit/cli
```

Or use directly with `npx`:

```bash
npx guidekit <command>
```

## Commands

### `guidekit init`

Scaffolds GuideKit into your project. Detects your framework (Next.js App Router, Pages Router, or generic React) and generates:

- Token endpoint with environment variable placeholders
- Provider component wrapping your app
- `.env.local` template with required keys

```bash
npx guidekit init
```

### `guidekit doctor`

Checks your environment for common issues:

- Required environment variables are set
- Packages are installed at compatible versions
- Provider API keys are valid and reachable
- Token endpoint responds correctly

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

Full documentation: [guidekit.dev/docs/cli](https://guidekit.dev/docs/cli)

## License

[MIT](../../LICENSE)
