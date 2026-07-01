import { describe, expect, it } from 'vitest';

import { parseCommit, type RawCommit } from '../src/parse.js';
import {
  buildUserPrompt,
  cleanModelOutput,
  COMMIT_SYSTEM_PROMPT,
  commitsToMaterial,
  isEmptyNotesSentinel,
  NO_USER_FACING_CHANGES,
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

  it('gives each change a single section home (helps smaller models)', () => {
    expect(SYSTEM_PROMPT).toContain('EXACTLY ONE section');
    expect(SYSTEM_PROMPT).toContain('Breaking Changes" only');
  });

  it('embeds the shared empty-notes sentinel verbatim', () => {
    expect(SYSTEM_PROMPT).toContain(NO_USER_FACING_CHANGES);
  });
});

describe('isEmptyNotesSentinel', () => {
  it('matches the exact sentinel, ignoring surrounding whitespace', () => {
    expect(isEmptyNotesSentinel(NO_USER_FACING_CHANGES)).toBe(true);
    expect(isEmptyNotesSentinel(`\n  ${NO_USER_FACING_CHANGES}  \n`)).toBe(true);
  });

  it('does not match real notes or partial text', () => {
    expect(isEmptyNotesSentinel('## Features\n- a')).toBe(false);
    expect(isEmptyNotesSentinel('No user-facing changes')).toBe(false);
    expect(isEmptyNotesSentinel(`${NO_USER_FACING_CHANGES}\n\n## Features`)).toBe(false);
    expect(isEmptyNotesSentinel('')).toBe(false);
  });
});

describe('COMMIT_SYSTEM_PROMPT', () => {
  it('asks for a Conventional Commit message, not grouped notes', () => {
    expect(COMMIT_SYSTEM_PROMPT).toContain('Conventional Commits');
    expect(COMMIT_SYSTEM_PROMPT).toContain('type(scope): description');
    expect(COMMIT_SYSTEM_PROMPT).toContain('BREAKING CHANGE');
  });
});

describe('cleanModelOutput (notes / template)', () => {
  it('strips a conversational preamble before the first heading', () => {
    // The exact wrapper observed from `claude -p` during GG-8 testing.
    const raw =
      "My apologies — I don't need to ask anything. Here are the release notes:\n\n## Features\n- Added a flag";
    expect(cleanModelOutput(raw, 'notes')).toBe('## Features\n- Added a flag');
  });

  it('strips a trailing conversational postamble after the last bullet', () => {
    const raw = '## Features\n- Added a flag\n\nHope that helps! Let me know if you want changes.';
    expect(cleanModelOutput(raw, 'notes')).toBe('## Features\n- Added a flag');
  });

  it('leaves already-clean notes unchanged', () => {
    const clean = '## Features\n- a\n\n## Bug Fixes\n- b';
    expect(cleanModelOutput(clean, 'notes')).toBe(clean);
  });

  it('preserves blank lines and bullets between sections', () => {
    const md = '## Features\n- a\n\n## Bug Fixes\n- b\n- c';
    expect(cleanModelOutput(`Here you go:\n\n${md}`, 'notes')).toBe(md);
  });

  it('leaves the _No changes_ sentinel (no heading) untouched', () => {
    expect(cleanModelOutput('_No user-facing changes._', 'notes')).toBe('_No user-facing changes._');
  });

  it('returns empty for blank/whitespace-only output', () => {
    expect(cleanModelOutput('', 'notes')).toBe('');
    expect(cleanModelOutput('   \n  ', 'notes')).toBe('');
  });
});

describe('cleanModelOutput (commit)', () => {
  it('strips a preamble before the commit subject', () => {
    const raw = "Here's a commit message for you:\n\nfeat: add a flag\n\n- details";
    expect(cleanModelOutput(raw, 'commit')).toBe('feat: add a flag\n\n- details');
  });

  it('leaves an already-clean commit message unchanged', () => {
    const clean = 'fix(api): handle empty body\n\n- guard against null';
    expect(cleanModelOutput(clean, 'commit')).toBe(clean);
  });

  it('does not strip on markdown rules (a commit has no heading)', () => {
    const clean = 'feat!: drop Node 18';
    expect(cleanModelOutput(clean, 'commit')).toBe(clean);
  });
});
