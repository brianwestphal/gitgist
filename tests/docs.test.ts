import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** Repo-root-relative path. */
function repoPath(rel: string): string {
  return fileURLToPath(new URL(`../${rel}`, import.meta.url));
}

/** `.ts` files directly under a repo-relative directory (no subdirectories). */
function tsFiles(relDir: string): string[] {
  return readdirSync(repoPath(relDir))
    .filter((name) => name.endsWith('.ts'))
    .sort();
}

/** camelCase identifier → kebab-case provider id (`claudeCliProvider` → `claude-cli`). */
function providerVarToId(varName: string): string {
  return varName
    .replace(/Provider$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
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

describe('docs/2-architecture.md stays in sync with the source layout', () => {
  const doc = readFileSync(repoPath('docs/2-architecture.md'), 'utf8');

  it('lists every src/*.ts module in the Modules table', () => {
    const files = tsFiles('src');
    // src/cli.ts shares its basename with src/providers/cli.ts, so match the
    // top-level files on their bare `name.ts` token (the providers check below
    // uses the `providers/` prefix, keeping the two distinct).
    const missing = files.filter((name) => !doc.includes(name));
    expect(
      missing,
      `These src/*.ts files are missing from the docs/2-architecture.md Modules table: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('lists every src/providers/*.ts module in the Modules table', () => {
    const files = tsFiles('src/providers');
    const missing = files.filter((name) => !doc.includes(`providers/${name}`));
    expect(
      missing,
      `These src/providers/*.ts files are missing from the docs/2-architecture.md Modules table (expected a \`providers/<name>\` mention): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('documents the same AUTO_ORDER as src/providers/index.ts', () => {
    const src = readFileSync(repoPath('src/providers/index.ts'), 'utf8');
    const match = /AUTO_ORDER[^=]*=\s*\[([^\]]*)\]/.exec(src);
    expect(match, 'could not find the AUTO_ORDER array in src/providers/index.ts').not.toBeNull();

    const ids = (match as RegExpExecArray)[1]
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
      .map(providerVarToId);
    expect(ids.length).toBeGreaterThan(0);

    const expected = `[${ids.join(', ')}]`;
    expect(
      doc.includes(expected),
      `docs/2-architecture.md should document AUTO_ORDER as ${expected} (derived from src/providers/index.ts)`,
    ).toBe(true);
  });
});
