import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/rendering.ts', 'src/cognitive/index.ts', 'src/telemetry/index.ts'],
  external: ['@guidekit/intelligence', '@guidekit/knowledge', '@guidekit/plugins', 'js-tiktoken'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  target: 'es2022',
});
