import { describe, expect, it } from 'vitest';

import { parseCommit, type RawCommit } from '../src/parse.js';
import {
  buildUserPrompt,
  cleanModelOutput,
  COMMIT_SYSTEM_PROMPT,
  commitsToMaterial,
  DIFF_IS_SOURCE_OF_TRUTH_RULES,
  isEmptyNotesSentinel,
  NO_CROSS_REFERENCE_RULES,
  NO_USER_FACING_CHANGES,
  rangeDiffToMaterial,
  stripCodeFences,
  SYSTEM_PROMPT,
  TEMPLATE_SYSTEM_PROMPT,
  workingChangesToMaterial,
} from '../src/prompt.js';
import type { Commit, RangeDiff, WorkingChanges } from '../src/types.js';

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

// @covers FR-11, FR-26
describe('workingChangesToMaterial', () => {
  const base: WorkingChanges = {
    staged: ['a.ts'],
    unstaged: [],
    untracked: [],
    excluded: [],
    diff: '### Staged changes\ndiff --git a/a.ts b/a.ts',
    truncated: false,
    isEmpty: false,
  };

  it('labels the diff as uncommitted changes', () => {
    const material = workingChangesToMaterial(base);
    expect(material).toContain('Uncommitted changes');
    expect(material).toContain('### Staged changes');
  });

  it('names files whose diff was held back as noise (GG-54)', () => {
    const material = workingChangesToMaterial({
      ...base,
      staged: ['a.ts', 'package-lock.json'],
      excluded: ['package-lock.json'],
    });
    expect(material).toContain('omitted as generated/lockfile noise');
    expect(material).toContain('package-lock.json');
    expect(material).toContain('do not describe their contents');
  });

  it('flags a truncated working-tree diff, matching the range-diff contract', () => {
    const material = workingChangesToMaterial({ ...base, truncated: true });
    expect(material).toContain('truncated to fit');
    expect(material).toContain('do not speculate about the omitted portion');
  });

  it('stays silent when nothing was held back', () => {
    const material = workingChangesToMaterial(base);
    expect(material).not.toContain('Note:');
  });
});

// @covers FR-4
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

// @covers FR-22
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

// @covers FR-12
describe('COMMIT_SYSTEM_PROMPT', () => {
  it('asks for a Conventional Commit message, not grouped notes', () => {
    expect(COMMIT_SYSTEM_PROMPT).toContain('Conventional Commits');
    expect(COMMIT_SYSTEM_PROMPT).toContain('type(scope): description');
    expect(COMMIT_SYSTEM_PROMPT).toContain('BREAKING CHANGE');
  });
});

// @covers FR-25
describe('DIFF_IS_SOURCE_OF_TRUTH_RULES (GG-50)', () => {
  it('makes the diff outrank commit messages and changelog prose', () => {
    expect(DIFF_IS_SOURCE_OF_TRUTH_RULES).toContain('authoritative record');
    expect(DIFF_IS_SOURCE_OF_TRUTH_RULES).toContain('the diff wins');
    expect(DIFF_IS_SOURCE_OF_TRUTH_RULES).toContain('secondary');
  });

  it('requires reporting diff-only changes and dropping unsupported claims', () => {
    expect(DIFF_IS_SOURCE_OF_TRUTH_RULES).toContain('even when no commit message mentions them');
    expect(DIFF_IS_SOURCE_OF_TRUTH_RULES).toContain('the diff does not support');
  });

  it('forbids speculating past a truncated patch', () => {
    expect(DIFF_IS_SOURCE_OF_TRUTH_RULES).toContain('truncated');
    expect(DIFF_IS_SOURCE_OF_TRUTH_RULES).toContain('cannot point to');
  });

  it('is embedded verbatim in every output format, so the rule cannot drift', () => {
    for (const prompt of [SYSTEM_PROMPT, TEMPLATE_SYSTEM_PROMPT, COMMIT_SYSTEM_PROMPT]) {
      expect(prompt).toContain(DIFF_IS_SOURCE_OF_TRUTH_RULES);
    }
  });
});

// @covers FR-25, FR-26
describe('rangeDiffToMaterial', () => {
  const base: RangeDiff = {
    range: 'v1.0.0..HEAD',
    files: ['src/a.ts'],
    stat: ' src/a.ts | 2 +-',
    patch: 'diff --git a/src/a.ts b/src/a.ts\n+export const added = 1;',
    excluded: [],
    truncated: false,
    isEmpty: false,
  };

  it('labels the diff as authoritative and carries the stat plus the patch', () => {
    const material = rangeDiffToMaterial(base);
    expect(material).toContain('Code diff for `v1.0.0..HEAD`');
    expect(material).toContain('authoritative record');
    expect(material).toContain('### Changed file (1)');
    expect(material).toContain(' src/a.ts | 2 +-');
    expect(material).toContain('### Patch');
    expect(material).toContain('+export const added = 1;');
  });

  it('pluralizes the changed-file count', () => {
    const material = rangeDiffToMaterial({ ...base, files: ['a.ts', 'b.ts'] });
    expect(material).toContain('### Changed files (2)');
  });

  it('names files whose diff was held back as noise, so nothing is silently hidden', () => {
    const material = rangeDiffToMaterial({
      ...base,
      files: ['src/a.ts', 'package-lock.json'],
      excluded: ['package-lock.json'],
    });
    expect(material).toContain('omitted as generated/lockfile noise');
    expect(material).toContain('package-lock.json');
    expect(material).toContain('do not describe their contents');
  });

  it('flags a truncated patch and bounds what may be claimed', () => {
    const material = rangeDiffToMaterial({ ...base, truncated: true });
    expect(material).toContain('truncated to fit');
    expect(material).toContain('do not speculate about the omitted portion');
  });

  it('omits the Patch heading when every changed file was noise', () => {
    const material = rangeDiffToMaterial({
      ...base,
      files: ['package-lock.json'],
      patch: '',
      excluded: ['package-lock.json'],
    });
    expect(material).not.toContain('### Patch');
    expect(material).toContain('### Changed file (1)');
  });

  it('renders nothing for an empty range', () => {
    expect(rangeDiffToMaterial({ ...base, isEmpty: true })).toBe('');
  });
});

// @covers FR-24
describe('NO_CROSS_REFERENCE_RULES (GG-51)', () => {
  it('forbids the observed "carried over / dedupe against the draft" section', () => {
    // The exact failure mode: a CHANGELOG `Unreleased` entry in the input made
    // the model defer to it instead of describing the change.
    expect(NO_CROSS_REFERENCE_RULES).toContain('Carried over from');
    expect(NO_CROSS_REFERENCE_RULES).toContain('dedupe against the draft above');
    expect(NO_CROSS_REFERENCE_RULES).toContain('de-duplicate');
  });

  it('names the changelog `Unreleased` case and requires describing it in full', () => {
    expect(NO_CROSS_REFERENCE_RULES).toContain('Unreleased');
    expect(NO_CROSS_REFERENCE_RULES).toContain('describe that change in full');
    expect(NO_CROSS_REFERENCE_RULES).toContain('Never defer to it');
  });

  it('declares changelog de-duplication out of scope', () => {
    expect(NO_CROSS_REFERENCE_RULES).toContain('out of scope');
  });

  it('is embedded verbatim in every output format, so the rule cannot drift', () => {
    // A format that grows its own paraphrase (or drops the block) fails here.
    for (const prompt of [SYSTEM_PROMPT, TEMPLATE_SYSTEM_PROMPT, COMMIT_SYSTEM_PROMPT]) {
      expect(prompt).toContain(NO_CROSS_REFERENCE_RULES);
    }
  });
});

// @covers NFR-7
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
