import { describe, expect, it } from 'vitest';

import { buildChangelog, renderMarkdown, renderWorkingChanges } from '../src/changelog.js';
import { parseCommit, type RawCommit } from '../src/parse.js';
import type { Commit, WorkingChanges } from '../src/types.js';

function commit(subject: string, body = '', hash = 'abcdef1234567890'): Commit {
  const r: RawCommit = { hash, subject, body, author: 'A', date: '2026-01-01T00:00:00Z' };
  return parseCommit(r);
}

// @covers FR-8
describe('buildChangelog', () => {
  it('groups commits by conventional type and omits empty sections', () => {
    const changelog = buildChangelog('v1..HEAD', [
      commit('feat: a'),
      commit('feat: b'),
      commit('fix: c'),
    ]);

    expect(changelog.sections.map((s) => s.title)).toEqual(['Features', 'Bug Fixes']);
    expect(changelog.sections[0].commits).toHaveLength(2);
  });

  it('routes unclassified commits into Other Changes', () => {
    const changelog = buildChangelog('v1..HEAD', [commit('totally freeform')]);
    expect(changelog.sections).toHaveLength(1);
    expect(changelog.sections[0].title).toBe('Other Changes');
  });

  it('collects breaking changes separately', () => {
    const changelog = buildChangelog('v1..HEAD', [
      commit('feat!: big change'),
      commit('fix: small'),
    ]);
    expect(changelog.breaking).toHaveLength(1);
    expect(changelog.breaking[0].description).toBe('big change');
  });
});

describe('renderMarkdown', () => {
  it('renders sections, titles, and scopes', () => {
    const changelog = buildChangelog('v1..HEAD', [commit('feat(cli): add flag')]);
    const md = renderMarkdown(changelog, { title: 'Release 1.1.0' });

    expect(md).toContain('# Release 1.1.0');
    expect(md).toContain('## Features');
    expect(md).toContain('**cli:** add flag');
  });

  it('renders a breaking-changes section first', () => {
    const changelog = buildChangelog('v1..HEAD', [commit('feat!: drop support')]);
    const md = renderMarkdown(changelog);
    expect(md.indexOf('BREAKING CHANGES')).toBeLessThan(md.indexOf('## Features'));
  });

  it('reports no changes for an empty range', () => {
    const changelog = buildChangelog('v1..HEAD', []);
    expect(renderMarkdown(changelog)).toBe('No changes.\n');
  });
});

// @covers FR-11
describe('renderWorkingChanges', () => {
  it('lists changed files grouped by category', () => {
    const working: WorkingChanges = {
      staged: ['src/a.ts'],
      unstaged: ['src/b.ts'],
      untracked: ['src/c.ts'],
      diff: '',
      isEmpty: false,
    };
    const md = renderWorkingChanges(working);
    expect(md).toContain('## Uncommitted changes');
    expect(md).toContain('### Staged');
    expect(md).toContain('- `src/a.ts`');
    expect(md).toContain('### Unstaged');
    expect(md).toContain('### Untracked');
  });

  it('omits empty categories', () => {
    const working: WorkingChanges = {
      staged: ['only.ts'],
      unstaged: [],
      untracked: [],
      diff: '',
      isEmpty: false,
    };
    const md = renderWorkingChanges(working);
    expect(md).toContain('### Staged');
    expect(md).not.toContain('### Unstaged');
    expect(md).not.toContain('### Untracked');
  });

  it('returns empty string when there are no changes', () => {
    const working: WorkingChanges = {
      staged: [],
      unstaged: [],
      untracked: [],
      diff: '',
      isEmpty: true,
    };
    expect(renderWorkingChanges(working)).toBe('');
  });
});
