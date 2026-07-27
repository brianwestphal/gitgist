import { describe, expect, it } from 'vitest';

import {
  buildExcludePathspecs,
  commitUrlFromRemote,
  DEFAULT_EXCLUDES,
  resolveCommitRange,
} from '../src/git.js';

// @covers FR-31
describe('commitUrlFromRemote (GG-59)', () => {
  it('handles the scp-like, https, and ssh:// remote forms', () => {
    expect(commitUrlFromRemote('git@github.com:owner/repo.git')).toBe(
      'https://github.com/owner/repo/commit/{hash}',
    );
    expect(commitUrlFromRemote('https://github.com/owner/repo.git')).toBe(
      'https://github.com/owner/repo/commit/{hash}',
    );
    expect(commitUrlFromRemote('https://github.com/owner/repo')).toBe(
      'https://github.com/owner/repo/commit/{hash}',
    );
    expect(commitUrlFromRemote('ssh://git@gitlab.com/group/sub/repo.git')).toBe(
      'https://gitlab.com/group/sub/repo/commit/{hash}',
    );
  });

  it('uses each host\'s own commit path', () => {
    // Bitbucket is /commits/, not /commit/ — guessing wrong yields a 404 link.
    expect(commitUrlFromRemote('https://bitbucket.org/o/r')).toBe(
      'https://bitbucket.org/o/r/commits/{hash}',
    );
  });

  it('normalizes host case but preserves the path', () => {
    expect(commitUrlFromRemote('git@GitHub.com:Owner/Repo.git')).toBe(
      'https://github.com/Owner/Repo/commit/{hash}',
    );
  });

  it('returns null rather than guessing an unknown host', () => {
    // A wrong URL is worse than a bare hash, so anything unrecognized opts out.
    expect(commitUrlFromRemote('https://git.internal.corp/o/r.git')).toBeNull();
    expect(commitUrlFromRemote('git@ssh.dev.azure.com:v3/org/proj/repo')).toBeNull();
    expect(commitUrlFromRemote('/local/path/repo')).toBeNull();
    expect(commitUrlFromRemote('')).toBeNull();
    expect(commitUrlFromRemote('https://github.com/')).toBeNull();
  });
});

// @covers FR-27
describe('buildExcludePathspecs (GG-53)', () => {
  it('applies the :(exclude) magic to the built-in defaults', () => {
    const specs = buildExcludePathspecs();
    expect(specs).toContain(':(exclude)*lock.json');
    expect(specs).toContain(':(exclude)dist/*');
    expect(specs).toHaveLength(DEFAULT_EXCLUDES.length);
  });

  it('appends extra patterns to the defaults', () => {
    const specs = buildExcludePathspecs(['migrations/*']);
    expect(specs).toContain(':(exclude)migrations/*');
    expect(specs).toContain(':(exclude)*.lock');
  });

  it('drops the defaults when asked, keeping only the extras', () => {
    expect(buildExcludePathspecs(['migrations/*'], false)).toEqual([':(exclude)migrations/*']);
  });

  it('returns an empty list when nothing is excluded, so no `--` is emitted', () => {
    expect(buildExcludePathspecs([], false)).toEqual([]);
    expect(buildExcludePathspecs(undefined, false)).toEqual([]);
  });

  it('de-duplicates and ignores blank patterns', () => {
    // A pattern repeated across the defaults and --exclude must appear once.
    const specs = buildExcludePathspecs(['dist/*', '   ', 'dist/*'], true);
    expect(specs.filter((s) => s === ':(exclude)dist/*')).toHaveLength(1);
    expect(specs).not.toContain(':(exclude)   ');
  });
});

// @covers FR-2
describe('resolveCommitRange', () => {
  it('builds from..to when both are given', async () => {
    expect(await resolveCommitRange('v1.0.0', 'HEAD')).toBe('v1.0.0..HEAD');
  });

  it('defaults the end to HEAD', async () => {
    expect(await resolveCommitRange('v1.0.0', undefined)).toBe('v1.0.0..HEAD');
  });

  it('builds from..to with an explicit end', async () => {
    expect(await resolveCommitRange('v1.0.0', 'v2.0.0')).toBe('v1.0.0..v2.0.0');
  });
});
