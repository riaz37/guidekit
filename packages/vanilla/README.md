# @guidekit/vanilla

[![npm version](https://img.shields.io/npm/v/@guidekit/vanilla?style=flat-square)](https://www.npmjs.com/package/@guidekit/vanilla)

Vanilla JavaScript bundle for the GuideKit SDK. Provides a script-tag integration for adding an AI assistant to any web page without React.

## Installation

### CDN (IIFE)

```html
<script src="https://unpkg.com/@guidekit/vanilla/dist/index.global.js"></script>
<script>
  GuideKit.init({
    tokenEndpoint: '/api/guidekit/token',
    agent: { name: 'Guide', greeting: 'Hello! How can I help?' },
    options: { mode: 'text' },
  });
</script>
```

### npm

```bash
npm install @guidekit/vanilla
```

```javascript
import { init, sendText, destroy } from '@guidekit/vanilla';

await init({
  tokenEndpoint: '/api/guidekit/token',
  agent: { name: 'Guide', greeting: 'Hello!' },
  options: { mode: 'text' },
});

// Send a message programmatically
await sendText('How do I get started?');

// Clean up when done
destroy();
```

## Imperative API

| Method | Description |
|--------|-------------|
| `init(config)` | Initialize the SDK and render the widget |
| `sendText(message)` | Send a text message to the assistant |
| `startVoice()` | Begin voice input (requires `@guidekit/vad`) |
| `stopVoice()` | Stop voice input |
| `destroy()` | Tear down the SDK and remove the widget |

## Documentation

- Full documentation: [guidekit.dev/docs/vanilla](https://guidekit.dev/docs/vanilla)
- [Main README](../../README.md)

## License

[MIT](../../LICENSE)
