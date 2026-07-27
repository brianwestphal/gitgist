import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readCommits, readRangeDiff, readWorkingChanges, resolveCommitRange } from '../src/git.js';
import { generateChangelog } from '../src/index.js';
import { generateReleaseNotes } from '../src/releaseNotes.js';

/** Run a git command in `cwd`, returning trimmed stdout. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Create an empty commit with the given subject. */
function commit(cwd: string, subject: string): void {
  git(cwd, 'commit', '--allow-empty', '-q', '-m', subject);
}

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitgist-it-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

// @covers FR-1, FR-8, NFR-3, NFR-5
describe('git + orchestration integration', () => {
  let tagged: string;
  let untagged: string;

  beforeAll(() => {
    // Repo with a tag partway through its history.
    tagged = initRepo();
    commit(tagged, 'feat: alpha');
    commit(tagged, 'fix: bravo');
    git(tagged, 'tag', 'v1.0.0');
    commit(tagged, 'feat: charlie');
    commit(tagged, 'docs: delta');

    // Repo with no tags at all.
    untagged = initRepo();
    commit(untagged, 'feat: only commit');
  });

  afterAll(() => {
    rmSync(tagged, { recursive: true, force: true });
    rmSync(untagged, { recursive: true, force: true });
  });

  it('readCommits parses the commits in a range', async () => {
    const commits = await readCommits('v1.0.0..HEAD', { cwd: tagged });
    expect(commits.map((c) => c.subject)).toEqual(['docs: delta', 'feat: charlie']);
    expect(commits[0].type).toBe('docs');
    expect(commits[1].type).toBe('feat');
  });

  it('resolveCommitRange auto-detects the latest tag', async () => {
    expect(await resolveCommitRange(undefined, undefined, tagged)).toBe('v1.0.0..HEAD');
  });

  it('resolveCommitRange falls back to full history when there are no tags', async () => {
    expect(await resolveCommitRange(undefined, undefined, untagged)).toBe('HEAD');
  });

  it('generateReleaseNotes (--no-ai) renders deterministic grouped Markdown', async () => {
    const notes = await generateReleaseNotes({
      range: 'v1.0.0..HEAD',
      ai: false,
      cwd: tagged,
      title: 'v1.1.0',
    });
    expect(notes).toContain('# v1.1.0');
    expect(notes).toContain('## Features');
    expect(notes).toContain('charlie');
    expect(notes).toContain('## Documentation');
    expect(notes).toContain('delta');
    // The fix landed before the tag, so it must not appear in this range.
    expect(notes).not.toContain('bravo');
  });

  it('generateReleaseNotes resolves the range itself when none is given', async () => {
    // No `range`/`from`/`to`: it must auto-resolve (untagged repo → full history)
    // rather than requiring an explicit range.
    const notes = await generateReleaseNotes({ ai: false, cwd: untagged });
    expect(notes).toContain('## Features');
    expect(notes).toContain('only commit');
  });

  it('generateReleaseNotes reports an empty range cleanly', async () => {
    const notes = await generateReleaseNotes({ range: 'HEAD..HEAD', ai: false, cwd: tagged });
    expect(notes.trim()).toBe('_No changes in `HEAD..HEAD`._');
  });

  it('generateChangelog renders the deterministic grouped changelog', async () => {
    const md = await generateChangelog('v1.0.0..HEAD', { cwd: tagged, title: 'v1.1.0' });
    expect(md).toContain('# v1.1.0');
    expect(md).toContain('## Features');
    expect(md).toContain('charlie');
    expect(md).toContain('## Documentation');
    expect(md).not.toContain('bravo');
  });
});

// @covers FR-25, FR-26
describe('readRangeDiff — the actual code diff for a range (GG-50)', () => {
  let repo: string;
  let untagged: string;

  beforeAll(() => {
    repo = initRepo();
    // Pre-tag history: content that must NOT leak into the post-tag range diff.
    writeFileSync(join(repo, 'old.ts'), 'export const beforeTheTag = 1;\n');
    git(repo, 'add', '.');
    commit(repo, 'feat: pre-tag work');
    git(repo, 'tag', 'v1.0.0');

    // Post-tag: a real source change, plus two kinds of noise whose diff body
    // must be held back (lockfile + build output) but whose *existence* must not.
    writeFileSync(join(repo, 'src.ts'), 'export function shipped(): string {\n  return "hi";\n}\n');
    writeFileSync(join(repo, 'package-lock.json'), `{"noise": "${'x'.repeat(400)}"}\n`);
    mkdirSync(join(repo, 'dist'));
    writeFileSync(join(repo, 'dist', 'bundle.js'), `const generated=${'0'.repeat(200)};\n`);
    git(repo, 'add', '.');
    commit(repo, 'feat: post-tag work');

    untagged = initRepo();
    writeFileSync(join(untagged, 'only.ts'), 'export const only = true;\n');
    git(untagged, 'add', '.');
    commit(untagged, 'feat: first ever commit');
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(untagged, { recursive: true, force: true });
  });

  it('returns the real patch text for the range, scoped to it', async () => {
    const diff = await readRangeDiff('v1.0.0..HEAD', { cwd: repo });
    expect(diff.isEmpty).toBe(false);
    expect(diff.range).toBe('v1.0.0..HEAD');
    expect(diff.files).toContain('src.ts');
    // The actual added source line — this is the whole point of GG-50: the
    // summary can be grounded in code, not just in "feat: post-tag work".
    expect(diff.patch).toContain('export function shipped()');
    expect(diff.stat).toContain('src.ts');
    // Pre-tag content is outside the range and must not appear.
    expect(diff.patch).not.toContain('beforeTheTag');
    expect(diff.files).not.toContain('old.ts');
  });

  it('lists generated/lockfile noise but holds back its diff body', async () => {
    const diff = await readRangeDiff('v1.0.0..HEAD', { cwd: repo });
    // Still visible as changed files — the model learns they changed…
    expect(diff.files).toContain('package-lock.json');
    expect(diff.files).toContain('dist/bundle.js');
    expect(diff.stat).toContain('package-lock.json');
    // …but their content never reaches the patch body, and is reported as held back.
    expect(diff.patch).not.toContain('xxxxxxxxxx');
    expect(diff.excluded).toContain('package-lock.json');
    expect(diff.excluded).toContain('dist/bundle.js');
    expect(diff.excluded).not.toContain('src.ts');
  });

  // @covers FR-29
  it('gives every changed file a share of the budget, whatever its path sorts as', async () => {
    // GG-57 regression. `git diff` emits files in path order, so a positional
    // cut spent the whole budget alphabetically: on this repo's own release
    // range every `src/` file got zero patch text while `.agents/` scaffolding
    // consumed the allowance. Here `zzz-late.ts` stands in for that — it sorts
    // last and is guaranteed to be pushed out by a prefix cut.
    const wide = initRepo();
    try {
      writeFileSync(join(wide, 'seed.txt'), 'seed\n');
      git(wide, 'add', '.');
      commit(wide, 'feat: seed');
      git(wide, 'tag', 'v1.0.0');

      // Two big files: one sorts first and would eat a positional budget whole.
      writeFileSync(join(wide, 'aaa-early.ts'), `export const early = "${'a'.repeat(4000)}";\n`);
      writeFileSync(join(wide, 'zzz-late.ts'), 'export function lateButImportant(): void {}\n');
      git(wide, 'add', '.');
      commit(wide, 'feat: two files');

      // A budget far too small for the early file alone.
      const diff = await readRangeDiff('v1.0.0..HEAD', { cwd: wide, maxChars: 1200 });

      expect(diff.truncated).toBe(true);
      // The late-sorting file is present — the defect was it getting nothing.
      expect(diff.patch).toContain('lateButImportant');
      expect(diff.patch).toContain('zzz-late.ts');
      // The early file is present too, just shortened rather than complete.
      expect(diff.patch).toContain('aaa-early.ts');
      expect(diff.trimmedFiles).toContain('aaa-early.ts');
      // Small files that fit are never listed as trimmed.
      expect(diff.trimmedFiles).not.toContain('zzz-late.ts');
    } finally {
      rmSync(wide, { recursive: true, force: true });
    }
  });

  // @covers FR-29
  it('keeps whole files whole when the budget allows, spending leftovers on the big ones', async () => {
    // Max-min fairness: a file smaller than its equal share takes only what it
    // needs and returns the rest, so small files stay complete.
    const mixed = initRepo();
    try {
      writeFileSync(join(mixed, 'seed.txt'), 'seed\n');
      git(mixed, 'add', '.');
      commit(mixed, 'feat: seed');
      git(mixed, 'tag', 'v1.0.0');

      writeFileSync(join(mixed, 'small.ts'), 'export const small = 1;\n');
      // Many short lines — ordinary source, not one giant minified line.
      const body = Array.from({ length: 300 }, (_, i) => `export const v${String(i)} = ${String(i)};`);
      writeFileSync(join(mixed, 'large.ts'), `${body.join('\n')}\n`);
      git(mixed, 'add', '.');
      commit(mixed, 'feat: mixed sizes');

      const diff = await readRangeDiff('v1.0.0..HEAD', { cwd: mixed, maxChars: 2000 });
      // The small file fits within its share, so it survives untouched…
      expect(diff.patch).toContain('export const small = 1;');
      expect(diff.trimmedFiles).toEqual(['large.ts']);
      // …and the large one absorbed the leftover rather than being cut to half.
      expect(diff.patch.length).toBeGreaterThan(1000);
      // Line-aligned: the kept portion never ends mid-statement.
      expect(diff.patch).not.toMatch(/export const v\d+ = \d*$/m);
    } finally {
      rmSync(mixed, { recursive: true, force: true });
    }
  });

  // @covers FR-29
  it('still yields content for a file that is one enormous line', async () => {
    // Line-aligning a 6000-char single-line file would rewind past all of its
    // content and leave only the diff header — so the cut falls back to raw.
    const oneLine = initRepo();
    try {
      writeFileSync(join(oneLine, 'seed.txt'), 'seed\n');
      git(oneLine, 'add', '.');
      commit(oneLine, 'feat: seed');
      git(oneLine, 'tag', 'v1.0.0');
      writeFileSync(join(oneLine, 'generated.ts'), `export const blob = "${'x'.repeat(6000)}";\n`);
      git(oneLine, 'add', '.');
      commit(oneLine, 'feat: generated blob');

      const diff = await readRangeDiff('v1.0.0..HEAD', { cwd: oneLine, maxChars: 2000 });
      expect(diff.trimmedFiles).toEqual(['generated.ts']);
      // Actual content, not just the `diff --git` header.
      expect(diff.patch).toContain('export const blob');
      expect(diff.patch.length).toBeGreaterThan(1000);
    } finally {
      rmSync(oneLine, { recursive: true, force: true });
    }
  });

  it('caps the patch at the char budget while keeping the file list complete', async () => {
    const diff = await readRangeDiff('v1.0.0..HEAD', { cwd: repo, maxChars: 40 });
    expect(diff.truncated).toBe(true);
    expect(diff.patch).toContain('diff truncated');
    expect(diff.trimmedFiles).toContain('src.ts');
    // The budget trims the patch only — knowing *which* files changed is never
    // sacrificed, so a huge range degrades gracefully instead of to nothing.
    expect(diff.files).toContain('src.ts');
    expect(diff.stat).toContain('src.ts');
  });

  it('diffs a bare revision against the empty tree (untagged repo, full history)', async () => {
    // `resolveCommitRange` yields a bare `HEAD` when there is no tag; the whole
    // tree is the change, so the empty tree is the only correct base.
    const diff = await readRangeDiff('HEAD', { cwd: untagged });
    expect(diff.isEmpty).toBe(false);
    expect(diff.files).toEqual(['only.ts']);
    expect(diff.patch).toContain('export const only = true;');
  });

  it('accepts the merge-base and open-ended range forms', async () => {
    // `a...b` passes straight through; `a..` means "…to HEAD". All three forms
    // must resolve to the same diff as the plain two-dot range.
    const [twoDot, threeDot, openEnded] = await Promise.all([
      readRangeDiff('v1.0.0..HEAD', { cwd: repo }),
      readRangeDiff('v1.0.0...HEAD', { cwd: repo }),
      readRangeDiff('v1.0.0..', { cwd: repo }),
    ]);
    expect(threeDot.files).toEqual(twoDot.files);
    expect(openEnded.files).toEqual(twoDot.files);
    expect(openEnded.patch).toContain('export function shipped()');
  });

  it('defaults cwd to process.cwd()', async () => {
    // An empty range keeps this fast and deterministic against the real repo.
    const diff = await readRangeDiff('HEAD..HEAD');
    expect(diff.isEmpty).toBe(true);
  });

  // @covers FR-27
  it('--exclude adds to the defaults; --no-default-excludes drops them', async () => {
    // Extra pattern on top of the built-ins: src.ts joins the lockfile in the
    // held-back set, while both stay listed as changed.
    const added = await readRangeDiff('v1.0.0..HEAD', { cwd: repo, exclude: ['src.ts'] });
    expect(added.excluded).toContain('src.ts');
    expect(added.excluded).toContain('package-lock.json');
    expect(added.files).toContain('src.ts');
    expect(added.patch).not.toContain('export function shipped()');

    // Built-ins dropped: the lockfile's diff is now wanted (the "my dist/ is the
    // product" case), so nothing is held back at all.
    const raw = await readRangeDiff('v1.0.0..HEAD', { cwd: repo, defaultExcludes: false });
    expect(raw.excluded).toEqual([]);
    expect(raw.patch).toContain('xxxxxxxxxx');
    expect(raw.patch).toContain('export function shipped()');

    // Dropped built-ins + an explicit pattern: only that pattern applies.
    const custom = await readRangeDiff('v1.0.0..HEAD', {
      cwd: repo,
      defaultExcludes: false,
      exclude: ['src.ts'],
    });
    expect(custom.excluded).toEqual(['src.ts']);
    expect(custom.patch).toContain('xxxxxxxxxx');
  });

  // @covers FR-26
  it('caps the per-file stat too, so a huge file list cannot dominate', async () => {
    // The stat has its own 4000-char cap, separate from the patch budget — a
    // range touching hundreds of files would otherwise crowd out the patch.
    const many = initRepo();
    try {
      writeFileSync(join(many, 'seed.txt'), 'seed\n');
      git(many, 'add', '.');
      commit(many, 'feat: seed');
      git(many, 'tag', 'v1.0.0');
      for (let i = 0; i < 220; i++) {
        writeFileSync(join(many, `file-${String(i).padStart(3, '0')}.ts`), `export const n${String(i)} = ${String(i)};\n`);
      }
      git(many, 'add', '.');
      commit(many, 'feat: many files');

      const diff = await readRangeDiff('v1.0.0..HEAD', { cwd: many });
      expect(diff.files).toHaveLength(220);
      expect(diff.stat).toContain('file list truncated');
      expect(diff.truncated).toBe(true);
      // The complete file list survives on `files` even though the stat is cut.
      expect(diff.files).toContain('file-219.ts');
    } finally {
      rmSync(many, { recursive: true, force: true });
    }
  });

  it('reports an empty range without running the patch commands', async () => {
    const diff = await readRangeDiff('HEAD..HEAD', { cwd: repo });
    expect(diff).toMatchObject({ isEmpty: true, files: [], stat: '', patch: '', truncated: false });
  });

  it('rejects on a revision git cannot resolve (so the caller can degrade)', async () => {
    await expect(readRangeDiff('no-such-tag..HEAD', { cwd: repo })).rejects.toThrow();
  });
});

// @covers FR-11
describe('working-tree changes integration', () => {
  let repo: string;

  beforeAll(() => {
    repo = initRepo();
    // One committed file to modify, so we have a tracked-but-unstaged change.
    writeFileSync(join(repo, 'tracked.txt'), 'original\n');
    git(repo, 'add', 'tracked.txt');
    commit(repo, 'feat: add tracked file');

    // Staged: a brand-new file added to the index.
    writeFileSync(join(repo, 'staged.txt'), 'staged content\n');
    git(repo, 'add', 'staged.txt');

    // Unstaged: modify the committed file without staging it.
    writeFileSync(join(repo, 'tracked.txt'), 'modified\n');

    // Untracked: a new file never added.
    writeFileSync(join(repo, 'untracked.txt'), 'brand new\n');

    // Untracked but empty: git still reports it as a new file, so the diff must
    // surface it even with zero content.
    writeFileSync(join(repo, 'empty.txt'), '');
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('readWorkingChanges categorizes staged / unstaged / untracked', async () => {
    const wc = await readWorkingChanges({
      cwd: repo,
      staged: true,
      unstaged: true,
      untracked: true,
    });
    expect(wc.isEmpty).toBe(false);
    expect(wc.staged).toContain('staged.txt');
    expect(wc.unstaged).toContain('tracked.txt');
    expect(wc.untracked).toContain('untracked.txt');
    expect(wc.untracked).toContain('empty.txt');
    expect(wc.diff).toContain('### Staged changes');
    expect(wc.diff).toContain('### Unstaged changes');
    expect(wc.diff).toContain('### New (untracked) files');
    expect(wc.diff).toContain('staged content');
  });

  // @covers FR-26
  it('keeps lockfile/build noise out of the working-tree patch without hiding it', async () => {
    // GG-54 regression: the working-tree path applied no noise filtering, so a
    // staged lockfile that sorted early could consume the entire budget and
    // push the real source change out of the prompt completely.
    const noisy = initRepo();
    try {
      writeFileSync(join(noisy, 'seed.txt'), 'seed\n');
      git(noisy, 'add', '.');
      commit(noisy, 'feat: seed');
      // Sorts before `src.ts`, and is far larger than the whole budget.
      writeFileSync(join(noisy, 'a-package-lock.json'), `{"noise":"${'x'.repeat(5000)}"}\n`);
      writeFileSync(join(noisy, 'src.ts'), 'export const realChange = true;\n');
      git(noisy, 'add', '.');

      const wc = await readWorkingChanges({ cwd: noisy, staged: true, maxChars: 2000 });
      // The lockfile is still reported as changed…
      expect(wc.staged).toContain('a-package-lock.json');
      expect(wc.excluded).toContain('a-package-lock.json');
      // …but its body never reaches the prompt, so the real change survives.
      expect(wc.diff).not.toContain('xxxxxxxxxx');
      expect(wc.diff).toContain('export const realChange = true;');
      expect(wc.excluded).not.toContain('src.ts');
    } finally {
      rmSync(noisy, { recursive: true, force: true });
    }
  });

  it('readWorkingChanges only reads requested categories', async () => {
    const wc = await readWorkingChanges({ cwd: repo, staged: true });
    expect(wc.staged).toContain('staged.txt');
    expect(wc.unstaged).toEqual([]);
    expect(wc.untracked).toEqual([]);
  });

  it('readWorkingChanges emits no sections when every requested category is empty', async () => {
    const clean = initRepo();
    try {
      writeFileSync(join(clean, 'committed.txt'), 'x\n');
      git(clean, 'add', 'committed.txt');
      commit(clean, 'feat: only commit');
      const wc = await readWorkingChanges({
        cwd: clean,
        staged: true,
        unstaged: true,
        untracked: true,
      });
      expect(wc.isEmpty).toBe(true);
      expect(wc.diff).toBe('');
    } finally {
      rmSync(clean, { recursive: true, force: true });
    }
  });

  // @covers FR-26
  it('honors maxChars for working-tree diffs, and gives a lone category the whole budget', async () => {
    // GG-54 regression: `--max-diff-chars` used to be ignored here entirely —
    // the working-tree path had its own hardcoded 8000-char per-section cap.
    const tight = await readWorkingChanges({ cwd: repo, staged: true, maxChars: 40 });
    expect(tight.truncated).toBe(true);
    expect(tight.diff.length).toBeLessThan(200);
    expect(tight.diff).toContain('diff truncated');

    // A single requested category gets the full budget, not a fixed third.
    const roomy = await readWorkingChanges({ cwd: repo, staged: true, maxChars: 100_000 });
    expect(roomy.truncated).toBe(false);
    expect(roomy.diff).toContain('staged content');
  });

  // @covers FR-26
  it('splits the budget across the sections that actually have content', async () => {
    // Three non-empty sections share the budget, so each gets a third — and the
    // total stays under the number the user asked for.
    const all = await readWorkingChanges({
      cwd: repo,
      staged: true,
      unstaged: true,
      untracked: true,
      maxChars: 600,
    });
    expect(all.diff).toContain('### Staged changes');
    expect(all.diff).toContain('### Unstaged changes');
    expect(all.diff).toContain('### New (untracked) files');
    // 3 sections × 200 chars + the section headers and truncation markers.
    expect(all.diff.length).toBeLessThan(600 + 400);
  });

  it('readWorkingChanges defaults cwd and returns empty when nothing is requested', async () => {
    // No options: cwd falls back to process.cwd() and no git category runs.
    const wc = await readWorkingChanges();
    expect(wc).toMatchObject({ staged: [], unstaged: [], untracked: [], isEmpty: true });
  });

  it('generateReleaseNotes (--no-ai) renders an Uncommitted changes section', async () => {
    const notes = await generateReleaseNotes({
      cwd: repo,
      ai: false,
      staged: true,
      unstaged: true,
      untracked: true,
    });
    expect(notes).toContain('## Uncommitted changes');
    expect(notes).toContain('- `staged.txt`');
    expect(notes).toContain('- `tracked.txt`');
    expect(notes).toContain('- `untracked.txt`');
    // No range was requested, so committed history must not appear.
    expect(notes).not.toContain('add tracked file');
  });

  it('reports cleanly when requested categories are empty', async () => {
    const clean = initRepo();
    try {
      writeFileSync(join(clean, 'a.txt'), 'x\n');
      git(clean, 'add', 'a.txt');
      commit(clean, 'feat: only commit');
      const notes = await generateReleaseNotes({ cwd: clean, ai: false, staged: true });
      expect(notes.trim()).toBe('_No uncommitted changes._');
    } finally {
      rmSync(clean, { recursive: true, force: true });
    }
  });

  it('--format commit rejects --no-ai when there is content to summarize', async () => {
    await expect(
      generateReleaseNotes({ cwd: repo, format: 'commit', ai: false, staged: true }),
    ).rejects.toThrow(/--format commit requires AI/);
  });

  it('--template rejects --no-ai when there is content', async () => {
    await expect(
      generateReleaseNotes({ cwd: repo, template: 'whatever.md', ai: false, staged: true }),
    ).rejects.toThrow(/--template requires AI/);
  });

  it('--template cannot be combined with --format commit', async () => {
    await expect(
      generateReleaseNotes({ cwd: repo, template: 'whatever.md', format: 'commit', staged: true }),
    ).rejects.toThrow(/--template cannot be combined with --format commit/);
  });
});
