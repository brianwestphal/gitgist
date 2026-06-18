import { describe, expect, it } from 'vitest';

import { parseCommit, type RawCommit } from '../src/parse.js';
import {
  buildUserPrompt,
  COMMIT_SYSTEM_PROMPT,
  commitsToMaterial,
  stripCodeFences,
  SYSTEM_PROMPT,
  workingChangesToMaterial,
} from '../src/prompt.js';
import type { Commit, WorkingChanges } from '../src/types.js';

function commit(subject: string, body = '', hash = 'abcdef1234567890'): Commit {
  const raw: RawCommit = { hash, subject, body, author: 'A', date: '2026-01-01T00:00:00Z' };
  return parseCommit(raw);
}

describe('stripCodeFences', () => {
  it('returns plain text unchanged', () => {
    expect(stripCodeFences('## Features\n- a')).toBe('## Features\n- a');
  });

  it('unwraps a ```markdown fence', () => {
    expect(stripCodeFences('```markdown\n## Features\n- a\n```')).toBe('## Features\n- a');
  });

  it('unwraps a bare ``` fence', () => {
    expect(stripCodeFences('```\nhello\n```')).toBe('hello');
  });

  it('leaves inner fenced code blocks alone', () => {
    const text = 'before\n```js\ncode\n```\nafter';
    expect(stripCodeFences(text)).toBe(text);
  });
});

describe('commitsToMaterial', () => {
  it('renders one bullet per subject', () => {
    expect(commitsToMaterial([commit('feat: a'), commit('fix: b')])).toBe('- feat: a\n- fix: b');
  });

  it('indents the body beneath the subject', () => {
    expect(commitsToMaterial([commit('feat: a', 'why it matters')])).toBe(
      '- feat: a\n  why it matters',
    );
  });

  it('truncates a long body', () => {
    const long = 'x'.repeat(600);
    const material = commitsToMaterial([commit('feat: a', long)]);
    expect(material).toContain('…');
    expect(material.length).toBeLessThan(600);
  });
});

describe('buildUserPrompt', () => {
  it('singularizes for one commit and includes the range', () => {
    const prompt = buildUserPrompt('v1..HEAD', [commit('feat: a')]);
    expect(prompt).toContain('1 commit in `v1..HEAD`');
    expect(prompt).toContain('- feat: a');
  });

  it('pluralizes for multiple commits', () => {
    const prompt = buildUserPrompt('v1..HEAD', [commit('feat: a'), commit('fix: b')]);
    expect(prompt).toContain('2 commits in `v1..HEAD`');
  });
});

describe('workingChangesToMaterial', () => {
  it('labels the diff as uncommitted changes', () => {
    const working: WorkingChanges = {
      staged: ['a.ts'],
      unstaged: [],
      untracked: [],
      diff: '### Staged changes\ndiff --git a/a.ts b/a.ts',
      isEmpty: false,
    };
    const material = workingChangesToMaterial(working);
    expect(material).toContain('Uncommitted changes');
    expect(material).toContain('### Staged changes');
  });
});

describe('SYSTEM_PROMPT', () => {
  it('instructs markdown-only, themed sections, and mentions diffs', () => {
    expect(SYSTEM_PROMPT).toContain('Markdown');
    expect(SYSTEM_PROMPT).toContain('##');
    expect(SYSTEM_PROMPT).toContain('diff');
  });
});

describe('COMMIT_SYSTEM_PROMPT', () => {
  it('asks for a Conventional Commit message, not grouped notes', () => {
    expect(COMMIT_SYSTEM_PROMPT).toContain('Conventional Commits');
    expect(COMMIT_SYSTEM_PROMPT).toContain('type(scope): description');
    expect(COMMIT_SYSTEM_PROMPT).toContain('BREAKING CHANGE');
  });
});
