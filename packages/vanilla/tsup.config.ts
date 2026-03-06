import { defineConfig } from 'tsup';
import pkg from './package.json';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs', 'iife'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  globalName: 'GuideKit',
  treeshake: true,
  define: { __GUIDEKIT_VERSION__: JSON.stringify(pkg.version) },
});
