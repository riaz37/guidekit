# @guidekit/vad

[![npm version](https://img.shields.io/npm/v/@guidekit/vad?style=flat-square)](https://www.npmjs.com/package/@guidekit/vad)

Voice Activity Detection package for the GuideKit SDK. Wraps the Silero VAD ONNX model to detect when a user is speaking, enabling half-duplex voice interactions with barge-in detection.

## Installation

```bash
npm install @guidekit/vad
```

This package is an optional peer dependency of `@guidekit/core`. It is automatically used when voice mode is enabled.

## How It Works

`@guidekit/vad` loads the Silero VAD model via ONNX Runtime Web and runs inference on audio frames from the microphone. It emits `speech_start` and `speech_end` events that the core engine uses to trigger STT and manage barge-in.

## Usage with GuideKit

When using `@guidekit/react` or `@guidekit/vanilla`, simply install this package and enable voice mode:

```tsx
<GuideKitProvider
  tokenEndpoint="/api/guidekit/token"
  agent={{ name: 'Guide' }}
  options={{ mode: 'voice' }}
>
  {children}
</GuideKitProvider>
```

The SDK detects the package automatically. If it is not installed and voice mode is requested, the SDK emits a `VAD_PACKAGE_MISSING` error and falls back to text-only mode.

## Standalone Usage

```typescript
import { createVAD } from '@guidekit/vad';

const vad = await createVAD({
  onSpeechStart: () => console.log('Speaking...'),
  onSpeechEnd: (audio) => console.log('Done, audio length:', audio.length),
});

// Start processing audio from a MediaStream
await vad.start(mediaStream);

// Stop
vad.destroy();
```

## Documentation

- Full documentation: [guidekit.dev/docs/voice](https://guidekit.dev/docs/voice)
- [Main README](../../README.md)

## License

[MIT](../../LICENSE)
