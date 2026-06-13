import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@guidekit/intelligence': path.resolve(__dirname, 'packages/intelligence/src/index.ts'),
      '@guidekit/knowledge': path.resolve(__dirname, 'packages/knowledge/src/index.ts'),
      '@guidekit/plugins': path.resolve(__dirname, 'packages/plugins/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'packages/core/src/__test-utils__/**',
        'packages/core/src/__fixtures__/**',
      ],
      thresholds: {
        statements: 80,
        branches: 70,
        'packages/core/src/intelligence/**': {
          statements: 75,
          branches: 60,
        },
      },
    },
  },
});
