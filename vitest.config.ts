import { defineConfig } from 'vitest/config';

/**
 * Unit tests. Fast and isolated.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts'],
      // Conservative floors (well under current ~85%) so coverage can't quietly
      // regress. The network/subprocess provider paths (anthropicApi/apple/local
      // real I/O) keep the global ceiling modest; their logic is unit-tested via
      // injected runners/fetch.
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 72,
        lines: 80,
      },
    },
  },
});
