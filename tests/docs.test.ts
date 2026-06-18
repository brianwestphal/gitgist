import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** Repo-root-relative path. */
function repoPath(rel: string): string {
  return fileURLToPath(new URL(`../${rel}`, import.meta.url));
}

/** Collect the named exports from a TypeScript barrel module. */
function namedExports(source: string): string[] {
  const names = new Set<string>();
  // `export { a, type B, c as d } from '...'` (and re-export type blocks), multi-line.
  for (const m of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        .trim();
      if (name !== '') names.add(name);
    }
  }
  // `export (async )?(function|const|class) NAME`
  for (const m of source.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g)) {
    names.add(m[1]);
  }
  return [...names].sort();
}

describe('docs/ai/code-summary.md stays in sync with the public API', () => {
  it('lists every named export of src/index.ts', () => {
    const exports = namedExports(readFileSync(repoPath('src/index.ts'), 'utf8'));
    const doc = readFileSync(repoPath('docs/ai/code-summary.md'), 'utf8');

    // Sanity: the barrel really does export a meaningful surface.
    expect(exports.length).toBeGreaterThan(30);

    const undocumented = exports.filter((name) => !doc.includes(name));
    expect(
      undocumented,
      `These src/index.ts exports are missing from docs/ai/code-summary.md (add them to the "Public API" section): ${undocumented.join(', ')}`,
    ).toEqual([]);
  });
});
