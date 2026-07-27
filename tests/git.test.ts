import { describe, expect, it } from 'vitest';

import { buildExcludePathspecs, DEFAULT_EXCLUDES, resolveCommitRange } from '../src/git.js';

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
