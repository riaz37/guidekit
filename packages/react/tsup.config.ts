import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.tsx', 'src/devtools.tsx', 'src/testing.tsx'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  target: 'es2022',
  external: ['react', 'react-dom'],
});
