import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readCommits, readWorkingChanges, resolveCommitRange } from '../src/git.js';
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
