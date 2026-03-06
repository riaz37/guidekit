import { defineConfig } from 'vitest/config';

export default defineConfig({
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
