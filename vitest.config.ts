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
      // Floors set just under the current numbers (100% lines / ~99.6% stmts /
      // ~98.9% funcs / ~97.1% branches) so coverage can't quietly regress. The
      // genuine live-I/O sinks (anthropicApi `defaultRun`, local `defaultFetch`)
      // and a handful of defensive guards are `v8 ignore`-annotated at the source
      // with a reason; everything else is unit-tested via injected runners/fetch.
      thresholds: {
        statements: 98,
        branches: 95,
        functions: 97,
        lines: 99,
      },
    },
  },
});
