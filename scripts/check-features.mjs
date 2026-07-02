/**
 * check:features — the feature/requirement coverage report.
 *
 * Orthogonal to the v8 line/branch coverage report: instead of asking "did every
 * line run?", it asks "does every documented behavior — and every documented
 * state *transition* — have a test that would fail if it regressed?". It parses
 * the FR / NFR / T rows from `docs/3-requirements.md` and the `@covers <ID>` tags
 * from the test files, then flags:
 *   - UNCOVERED — a Shipped/Partial requirement (or any T-transition) with no
 *     `@covers` tag. This is the gap a green 100% coverage report can hide.
 *   - STALE — a `@covers` tag naming an id that no longer exists in the doc.
 *
 * Exits non-zero on any uncovered or stale entry so it can gate CI / pre-commit.
 * Run: `npm run check:features` (also enforced inside `npm test` via
 * `tests/conventions.test.ts`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { collectCovers, computeCoverage, parseRequirements } from './lib/features.mjs';

/** Repo-root-relative path. */
const repoPath = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

/** Read every `*.test.ts` file under `tests/` as `{ name, text }`. */
function readTestFiles() {
  const dir = repoPath('tests');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.test.ts'))
    .sort()
    .map((name) => ({ name: `tests/${name}`, text: readFileSync(`${dir}/${name}`, 'utf8') }));
}

const requirements = parseRequirements(readFileSync(repoPath('docs/3-requirements.md'), 'utf8'));
const coversById = collectCovers(readTestFiles());
const { required, uncovered, stale } = computeCoverage(requirements, coversById);

const CHECK = '✓';
const CROSS = '✗';

console.log(`Feature coverage — ${String(required.length)} required behaviors\n`);
for (const r of required) {
  const files = coversById.get(r.id);
  const mark = files === undefined ? CROSS : CHECK;
  const where = files === undefined ? 'NO ASSERTING TEST' : files.join(', ');
  console.log(`  ${mark} ${r.id.padEnd(6)} ${where}`);
}

let failed = false;
if (uncovered.length > 0) {
  failed = true;
  console.error(
    `\n${CROSS} ${String(uncovered.length)} documented behavior(s) with no @covers test: ${uncovered.join(', ')}`,
  );
  console.error(
    '  Add a `@covers <ID>` tag next to a test that asserts the behavior, or (if it is a real gap) write that test.',
  );
}
if (stale.length > 0) {
  failed = true;
  console.error(
    `\n${CROSS} ${String(stale.length)} @covers tag(s) name an unknown requirement id: ${stale.join(', ')}`,
  );
  console.error('  Fix the typo, or drop the tag if the requirement was removed.');
}

if (failed) {
  process.exit(1);
}
console.log(`\n${CHECK} every documented behavior and transition has an asserting test.`);
