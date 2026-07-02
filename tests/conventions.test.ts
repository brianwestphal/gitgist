/**
 * Convention guards — the requirement-level invariants line/branch coverage can't
 * express (surfaced by the feature-coverage exercise, GG-45):
 *
 *   - **Feature coverage**: every documented behavior (FR-N / NFR-N) and every
 *     documented state *transition* (T-N) in `docs/3-requirements.md` has a
 *     `@covers` tag on an asserting test. This is the axis line coverage is blind
 *     to — a behavior can be 100% line-covered by isolated tests yet have no test
 *     asserting a multi-step sequence. Mirrors `npm run check:features`.
 *   - **FR-16 / NFR-1**: the notarized Apple helper ships in the `apple-fm`
 *     dependency, so gitgist neither builds/signs its own (no swift/codesign job)
 *     nor pulls in any runtime dep beyond the sanctioned two.
 *   - **NFR-4**: relative imports carry the `.js` extension; only the two provider
 *     modules that need them import the external SDKs — the core stays SDK-free.
 *   - The public API exports exactly the documented surface (a dropped or renamed
 *     export fails here, not just in review).
 *
 * The `@covers` tags below map FR-16 / NFR-1 / NFR-4 to their guards here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { collectCovers, computeCoverage, parseRequirements } from '../scripts/lib/features.mjs';
import * as api from '../src/index.js';

/** Repo-root-relative path. */
function repoPath(rel: string): string {
  return fileURLToPath(new URL(`../${rel}`, import.meta.url));
}

const pkg = JSON.parse(readFileSync(repoPath('package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
};

/** External (non-relative, non-`node:`) module specifiers imported by a source file. */
function externalImports(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const specs: string[] = [];
  for (const re of [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    for (const m of code.matchAll(re)) {
      const spec = m[1];
      if (!spec.startsWith('.') && !spec.startsWith('node:')) specs.push(spec);
    }
  }
  return specs;
}

/** Every `.ts` file under `src/` (recursively), as `{ rel, source }`. */
function srcFiles(): { rel: string; source: string }[] {
  const root = repoPath('src');
  const out: { rel: string; source: string }[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
      else if (entry.name.endsWith('.ts'))
        out.push({ rel: `${prefix}${entry.name}`, source: readFileSync(full, 'utf8') });
    }
  };
  walk(root, '');
  return out;
}

describe('feature coverage — every documented behavior has an asserting test (GG-45)', () => {
  const requirements = parseRequirements(readFileSync(repoPath('docs/3-requirements.md'), 'utf8'));
  const testsDir = repoPath('tests');
  const testFiles = readdirSync(testsDir)
    .filter((name) => name.endsWith('.test.ts'))
    .map((name) => ({ name: `tests/${name}`, text: readFileSync(`${testsDir}/${name}`, 'utf8') }));
  const covers = collectCovers(testFiles);
  const { required, uncovered, stale } = computeCoverage(requirements, covers);

  it('parses a meaningful requirement set from docs/3-requirements.md', () => {
    // Sanity: the doc really has FR/NFR/T rows (guards against a parser regression
    // silently reporting "everything covered" over an empty set).
    expect(required.length).toBeGreaterThan(20);
    expect(requirements.some((r) => r.kind === 'T')).toBe(true);
  });

  it('has a @covers test for every Shipped/Partial requirement and every T-transition', () => {
    expect(
      uncovered,
      `Documented behaviors with no @covers test (add a \`@covers <ID>\` tag on an asserting test, or write it): ${uncovered.join(', ')}`,
    ).toEqual([]);
  });

  it('has no @covers tag naming an unknown requirement id', () => {
    expect(
      stale,
      `@covers tags reference ids not in docs/3-requirements.md (typo, or the requirement was removed): ${stale.join(', ')}`,
    ).toEqual([]);
  });
});

describe('public API surface (FR-10 programmatic API)', () => {
  it('exports exactly the documented runtime surface', () => {
    expect(Object.keys(api).sort()).toEqual([
      'AUTO_LANGUAGE',
      'AUTO_ORDER',
      'COMMIT_SYSTEM_PROMPT',
      'DEFAULT_GROUPS',
      'DEFAULT_LOCAL_ENDPOINT',
      'NO_USER_FACING_CHANGES',
      'PROVIDERS',
      'SYSTEM_PROMPT',
      'TEMPLATE_SYSTEM_PROMPT',
      'anthropicApiProvider',
      'appleProvider',
      'buildChangelog',
      'buildTemplatePrompt',
      'buildUserPrompt',
      'claudeCliProvider',
      'cleanModelOutput',
      'codexProvider',
      'commitsToMaterial',
      'createAnthropicApiProvider',
      'createAppleProvider',
      'createCliProvider',
      'createLocalProvider',
      'detectSystemLanguage',
      'geminiProvider',
      'generateChangelog',
      'generateReleaseNotes',
      'isEmptyNotesSentinel',
      'latestTag',
      'loadTemplate',
      'localProvider',
      'opencodeProvider',
      'parseCommit',
      'parseTemplate',
      'readCommits',
      'readWorkingChanges',
      'renderMarkdown',
      'renderWorkingChanges',
      'resolveCommitRange',
      'resolveProvider',
      'stripCodeFences',
      'workingChangesToMaterial',
    ]);
  });
});

// @covers FR-16, NFR-1
describe('dependency allow-list (NFR-1, NFR-4, FR-16)', () => {
  it('declares only the two sanctioned runtime dependencies', () => {
    // The notarized Apple helper ships inside `apple-fm` (FR-16); the Anthropic
    // SDK backs the optional API provider. Anything else is a supply-chain
    // regression and must be justified with a new requirement.
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(['@anthropic-ai/sdk', 'apple-fm']);
  });

  it('ships the Apple helper via apple-fm, not a gitgist-side build/sign job (FR-16)', () => {
    const release = readFileSync(repoPath('.github/workflows/release.yml'), 'utf8');
    expect(pkg.dependencies?.['apple-fm']).toBeDefined();
    // No swift build / codesign / notarytool invocation — gitgist neither builds
    // nor signs its own helper anymore.
    expect(/\bswift build\b/.test(release)).toBe(false);
    expect(/\bcodesign\b/.test(release)).toBe(false);
    expect(/\bnotarytool\b/.test(release)).toBe(false);
  });
});

// @covers NFR-4
describe('module structure (NFR-4)', () => {
  const files = srcFiles();

  it('every relative import carries an explicit .js extension (ESM)', () => {
    const offenders: string[] = [];
    for (const { rel, source } of files) {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const re of [/\bfrom\s*['"](\.[^'"]+)['"]/g, /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g]) {
        for (const m of code.matchAll(re)) {
          if (!m[1].endsWith('.js')) offenders.push(`${rel}: ${m[1]}`);
        }
      }
    }
    expect(offenders, `relative imports missing the .js extension: ${offenders.join(', ')}`).toEqual(
      [],
    );
  });

  it('only the two provider modules import an external SDK; the core stays SDK-free', () => {
    // Which src files are allowed to import which external module. The point of
    // the guard: an `@anthropic-ai/sdk` (or any dep) import leaking into git.ts /
    // parse.ts / changelog.ts / prompt.ts / releaseNotes.ts fails here.
    const allowed = new Map<string, string[]>([
      ['providers/anthropicApi.ts', ['@anthropic-ai/sdk']],
      ['providers/apple.ts', ['apple-fm']],
    ]);
    const offenders: string[] = [];
    for (const { rel, source } of files) {
      for (const spec of externalImports(source)) {
        const list = allowed.get(rel);
        if (list === undefined || !list.includes(spec)) offenders.push(`${rel}: ${spec}`);
      }
    }
    expect(
      offenders,
      `unexpected external imports (only providers/anthropicApi.ts and providers/apple.ts may import an SDK): ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
