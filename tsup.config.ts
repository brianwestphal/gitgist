import { defineConfig } from 'tsup';

/**
 * Library + CLI build.
 *
 * - `index` is the public programmatic API for generating release notes.
 * - `cli` is the `gitgist` bin. Its source keeps a leading
 *   `#!/usr/bin/env node` shebang, which esbuild preserves on entry points,
 *   so no banner injection is needed.
 *
 * `@anthropic-ai/sdk` is a runtime dependency — never bundled; it's resolved
 * from node_modules at runtime (and imported lazily).
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: 'esm',
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  splitting: false,
  clean: true,
  sourcemap: true,
  dts: true,
  external: ['@anthropic-ai/sdk'],
});
