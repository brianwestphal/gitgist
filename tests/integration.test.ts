import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readCommits, resolveCommitRange } from '../src/git.js';
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

  it('generateReleaseNotes reports an empty range cleanly', async () => {
    const notes = await generateReleaseNotes({ range: 'HEAD..HEAD', ai: false, cwd: tagged });
    expect(notes.trim()).toBe('_No changes in `HEAD..HEAD`._');
  });
});
