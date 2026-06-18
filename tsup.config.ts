import { defineConfig } from 'tsup';

/**
 * Library + CLI build.
 *
 * - `index` is the public programmatic API for generating changelogs.
 * - `cli` is the `gitgist` bin. Its source keeps a leading
 *   `#!/usr/bin/env node` shebang, which esbuild preserves on entry points,
 *   so no banner injection is needed.
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
});
